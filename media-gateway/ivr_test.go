package main

import (
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"strings"
	"testing"
	"time"
)

func TestGatewayNegotiatesTelephoneEventAt8000Hz(t *testing.T) {
	g, err := newGateway("127.0.0.1", 40000, 40100)
	if err != nil {
		t.Fatal(err)
	}
	remote, err := g.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		t.Fatal(err)
	}
	defer remote.Close()
	if _, err = remote.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
		t.Fatal(err)
	}
	offer, err := remote.CreateOffer(nil)
	if err != nil {
		t.Fatal(err)
	}
	answer, err := g.prepareInbound("ivr-codec-test", offer.SDP)
	if err != nil {
		t.Fatal(err)
	}
	defer g.closeSession("ivr-codec-test")
	if !strings.Contains(answer, "telephone-event/8000") {
		t.Fatal("answer cannot receive WhatsApp keypad tones")
	}
}

func TestInboundKeepsOpusWhenDTMFMatchesAndAudioParametersDiffer(t *testing.T) {
	for _, fmtp := range []string{"minptime=20;useinbandfec=1", "minptime=10;useinbandfec=0"} {
		t.Run(fmtp, func(t *testing.T) {
			g, err := newGateway("127.0.0.1", 40000, 40100)
			if err != nil {
				t.Fatal(err)
			}
			var remoteEngine webrtc.MediaEngine
			for _, codec := range []webrtc.RTPCodecParameters{
				{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2, SDPFmtpLine: fmtp}, PayloadType: 111},
				{RTPCodecCapability: webrtc.RTPCodecCapability{MimeType: "audio/telephone-event", ClockRate: 8000, SDPFmtpLine: "0-15"}, PayloadType: 126},
			} {
				if err = remoteEngine.RegisterCodec(codec, webrtc.RTPCodecTypeAudio); err != nil {
					t.Fatal(err)
				}
			}
			remote, err := webrtc.NewAPI(webrtc.WithMediaEngine(&remoteEngine)).NewPeerConnection(webrtc.Configuration{})
			if err != nil {
				t.Fatal(err)
			}
			defer remote.Close()
			if _, err = remote.AddTransceiverFromKind(webrtc.RTPCodecTypeAudio); err != nil {
				t.Fatal(err)
			}
			offer, err := remote.CreateOffer(nil)
			if err != nil {
				t.Fatal(err)
			}
			if err = remote.SetLocalDescription(offer); err != nil {
				t.Fatal(err)
			}
			if err = waitGathering(remote); err != nil {
				t.Fatal(err)
			}
			audioReceived := make(chan struct{}, 1)
			remote.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
				for {
					packet, _, readErr := track.ReadRTP()
					if readErr != nil {
						return
					}
					if len(packet.Payload) > 3 && strings.EqualFold(track.Codec().MimeType, webrtc.MimeTypeOpus) {
						select {
						case audioReceived <- struct{}{}:
						default:
						}
						return
					}
				}
			})
			answer, err := g.prepareInbound("ivr-codec-parameters", remote.LocalDescription().SDP)
			if err != nil {
				t.Fatal(err)
			}
			defer g.closeSession("ivr-codec-parameters")
			if !strings.Contains(answer, "opus/48000/2") || !strings.Contains(answer, "telephone-event/8000") {
				t.Fatal("answer must negotiate both audio and keypad tones")
			}
			if err = remote.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer}); err != nil {
				t.Fatal(err)
			}
			if err = g.playIvr("ivr-codec-parameters", true); err != nil {
				t.Fatal(err)
			}
			select {
			case <-audioReceived:
			case <-time.After(5 * time.Second):
				t.Fatal("caller did not receive IVR recording over RTP")
			}
		})
	}
}

func TestBundledPromptHasPlayableOpusPackets(t *testing.T) {
	packets, err := opusPackets(menuAudio)
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) < 300 {
		t.Fatal("recording truncated")
	}
	for _, p := range packets {
		if len(p) == 0 {
			t.Fatal("empty audio frame")
		}
	}
	if _, err := opusPackets(menuAudio[:30]); err == nil {
		t.Fatal("truncated recording accepted")
	}
}

func TestDTMFEndPacketsDeduplicateWithoutLosingRepeatedKeys(t *testing.T) {
	s := &callSession{ivrStarted: true}
	p := &rtp.Packet{Header: rtp.Header{Timestamp: 1200}, Payload: []byte{1, 0x80, 0x10, 0}}
	s.receiveDigit(p)
	s.receiveDigit(p)
	if len(s.ivrDigits) != 1 || s.ivrDigits[0].Digit != "1" {
		t.Fatal("duplicate DTMF digit")
	}
	p.Timestamp += 48000
	s.receiveDigit(p)
	if len(s.ivrDigits) != 2 {
		t.Fatal("new press ignored")
	}
	p.Payload[0] = 9
	p.Timestamp += 48000
	s.receiveDigit(p)
	if s.ivrDigits[2].Digit != "9" {
		t.Fatal("repeat menu key lost")
	}
	s.currentAgent = "72"
	p.Timestamp += 48000
	s.receiveDigit(p)
	if len(s.ivrDigits) != 3 {
		t.Fatal("human call consumed a menu key")
	}
}
