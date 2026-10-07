package main

import (
	"bytes"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
	"net"
	"strings"
	"testing"
	"time"
)

func TestGatewayAdvertisesOnlyConfiguredAddressFamily(t *testing.T) {
	for _, publicIP := range []string{"192.0.2.10", "2001:db8::10"} {
		t.Run(publicIP, func(t *testing.T) {
			g, err := newGateway(publicIP, 40000, 40100)
			if err != nil {
				t.Fatal(err)
			}
			remote, err := webrtc.NewPeerConnection(webrtc.Configuration{})
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
			// Offer both address families, as Meta does. The answer must expose
			// only the family selected by MEDIA_PUBLIC_IP even on a dual-stack host.
			offer.SDP += "a=candidate:ipv4 1 udp 2130706431 192.0.2.20 3480 typ host\r\n" +
				"a=candidate:ipv6 1 udp 2130706430 2001:db8::20 3480 typ host\r\n"
			answer, err := g.prepareInbound("address-family", offer.SDP)
			if err != nil {
				t.Fatal(err)
			}
			defer g.closeSession("address-family")
			count := 0
			for _, line := range strings.Split(answer, "\r\n") {
				if !strings.HasPrefix(line, "a=candidate:") {
					continue
				}
				parts := strings.Fields(line)
				if len(parts) < 8 || !strings.EqualFold(parts[2], "udp") {
					t.Fatalf("unexpected candidate: %s", line)
				}
				ip := net.ParseIP(parts[4])
				if ip == nil || !ip.Equal(net.ParseIP(publicIP)) {
					t.Fatalf("unconfigured audio path advertised: %s", line)
				}
				count++
			}
			if count == 0 {
				t.Skip("host has no interface for this IP family")
			}
		})
	}
}

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

func TestWaitPromptReplacesMenuInRunningPlayer(t *testing.T) {
	waitPackets, err := opusPackets(waitAudio)
	if err != nil {
		t.Fatal(err)
	}
	if len(waitPackets) < 100 {
		t.Fatal("waiting recording truncated")
	}
	g := &gateway{sessions: make(map[string]*callSession)}
	s, err := g.newSession("waiting-prompt")
	if err != nil {
		t.Fatal(err)
	}
	// Exercise switching recordings in the already running playback loop.
	s.ivrStarted = true
	s.ivrCursor = 100
	if err = g.playIvr(s.id, false, "wait"); err != nil {
		t.Fatal(err)
	}
	if !s.ivrPlaying || s.ivrCursor != 0 || len(s.ivrPackets) != len(waitPackets) || !bytes.Equal(s.ivrPackets[0], waitPackets[0]) {
		t.Fatal("waiting message did not replace the menu from its beginning")
	}
	if err = g.playIvr(s.id, false); err != nil {
		t.Fatal(err)
	}
	if s.ivrPlaying {
		t.Fatal("silence request kept the message playing")
	}
	if err = g.playIvr(s.id, false, "unknown"); err == nil {
		t.Fatal("unknown prompt accepted")
	}
	s.currentAgent = "72"
	if err = g.playIvr(s.id, false, "wait"); err == nil {
		t.Fatal("waiting recording interrupted a human call")
	}
}

func TestWaitingAudioDoesNotBlockReadinessDuringDTLSNegotiation(t *testing.T) {
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
	if _, err = g.prepareInbound("pending-dtls", offer.SDP); err != nil {
		t.Fatal(err)
	}
	defer g.closeSession("pending-dtls")
	s, _ := g.session("pending-dtls")
	// Close the peer first if a regression leaves playback blocked on SRTP.
	defer s.metaPeer.Close()
	if err = g.playIvr("pending-dtls", false); err != nil {
		t.Fatal(err)
	}
	time.Sleep(60 * time.Millisecond)
	done := make(chan struct{})
	go func() { _, _ = g.metaReady("pending-dtls"); close(done) }()
	select {
	case <-done:
	case <-time.After(300 * time.Millisecond):
		t.Fatal("readiness blocked by audio before DTLS connects")
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
