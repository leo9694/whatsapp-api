package main

import (
	"bytes"
	_ "embed"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

//go:embed audio/menu.ogg
var menuAudio []byte

//go:embed audio/aguarde.ogg
var waitAudio []byte

type ivrDigit struct {
	ID    uint64 `json:"id"`
	Digit string `json:"digit"`
}

// The bundled file uses one Opus frame of 20 ms per packet. Reassemble Ogg
// lacing, including packets spanning pages, rather than treating pages as RTP.
func opusPackets(data []byte) ([][]byte, error) {
	r := bytes.NewReader(data)
	var packets [][]byte
	var pending []byte
	for r.Len() > 0 {
		header := make([]byte, 27)
		if _, err := io.ReadFull(r, header); err != nil {
			return nil, err
		}
		if string(header[:4]) != "OggS" || header[4] != 0 {
			return nil, fmt.Errorf("invalid Ogg page")
		}
		laces := make([]byte, int(header[26]))
		if _, err := io.ReadFull(r, laces); err != nil {
			return nil, err
		}
		for _, size := range laces {
			part := make([]byte, int(size))
			if _, err := io.ReadFull(r, part); err != nil {
				return nil, err
			}
			pending = append(pending, part...)
			if size < 255 {
				if len(pending) > 0 && !bytes.HasPrefix(pending, []byte("OpusHead")) && !bytes.HasPrefix(pending, []byte("OpusTags")) {
					packets = append(packets, pending)
				}
				pending = nil
			}
		}
	}
	if len(pending) > 0 || len(packets) == 0 {
		return nil, fmt.Errorf("incomplete Opus recording")
	}
	return packets, nil
}

func (s *callSession) receiveDigit(packet *rtp.Packet) {
	if len(packet.Payload) < 4 || packet.Payload[1]&0x80 == 0 || packet.Payload[0] > 15 {
		return
	}
	key := fmt.Sprintf("%d:%d", packet.Timestamp, packet.Payload[0])
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ivrStarted || s.currentAgent != "" || key == s.ivrLastDigit {
		return
	}
	s.ivrLastDigit = key
	s.ivrDigitID++
	s.ivrDigits = append(s.ivrDigits, ivrDigit{ID: s.ivrDigitID, Digit: string("0123456789*#ABCD"[packet.Payload[0]])})
	if len(s.ivrDigits) > 32 {
		s.ivrDigits = s.ivrDigits[len(s.ivrDigits)-32:]
	}
}

func (g *gateway) playIvr(callID string, menu bool, prompt ...string) error {
	s, err := g.session(callID)
	if err != nil {
		return err
	}
	audio := menuAudio
	playing := menu
	if len(prompt) > 0 && prompt[0] != "" {
		if prompt[0] != "wait" {
			return fmt.Errorf("unknown IVR prompt")
		}
		audio = waitAudio
		playing = true
	}
	packets, err := opusPackets(audio)
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed || s.currentAgent != "" {
		s.mu.Unlock()
		return fmt.Errorf("call no longer waiting")
	}
	s.ivrPlaying = playing
	s.ivrPackets = packets
	s.ivrCursor = 0
	started := s.ivrStarted
	s.ivrStarted = true
	s.mu.Unlock()
	if started {
		return nil
	}
	go func() {
		ticker := time.NewTicker(20 * time.Millisecond)
		defer ticker.Stop()
		source := &agentPeer{id: "__ura"}
		var timestamp uint32
		var sequence uint16
		for range ticker.C {
			s.mu.Lock()
			if s.closed || s.currentAgent != "" {
				s.mu.Unlock()
				return
			}
			payload := []byte{0xf8, 0xff, 0xfe} // Opus comfort silence keeps the media leg alive.
			if s.ivrPlaying && s.metaPeer != nil && s.metaPeer.ConnectionState() == webrtc.PeerConnectionStateConnected {
				payload = s.ivrPackets[s.ivrCursor]
				s.ivrCursor++
				if s.ivrCursor == len(s.ivrPackets) {
					s.ivrPlaying = false
				}
			}
			if s.toMeta != nil {
				packet := &rtp.Packet{Header: rtp.Header{Version: 2, SequenceNumber: sequence, Timestamp: timestamp}, Payload: payload}
				_ = s.toMeta.WriteRTP(s.toMetaRTP.rewrite(source, packet))
			}
			s.mu.Unlock()
			timestamp += 960
			sequence++
		}
	}()
	return nil
}

func (s *callSession) ivrSnapshot() map[string]any {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return map[string]any{"digits": append([]ivrDigit{}, s.ivrDigits...), "playing": s.ivrPlaying}
}

func isTelephoneEvent(track *webrtc.TrackRemote) bool {
	return strings.EqualFold(track.Codec().MimeType, "audio/telephone-event")
}
