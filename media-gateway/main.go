package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/pion/interceptor"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

const maxBodyBytes = 512 * 1024

type agentPeer struct {
	id      string
	name    string
	peer    *webrtc.PeerConnection
	toAgent *webrtc.TrackLocalStaticRTP
	ready   atomic.Bool
	lastRTP atomic.Int64
}

type callSession struct {
	mu            sync.RWMutex
	id            string
	metaPeer      *webrtc.PeerConnection
	toMeta        *webrtc.TrackLocalStaticRTP
	metaLocalSDP  string
	metaRemoteSDP string
	agents        map[string]*agentPeer
	currentAgent  string
	createdAt     time.Time
}

type gateway struct {
	mu       sync.RWMutex
	api      *webrtc.API
	sessions map[string]*callSession
}

type agentHealth struct {
	Ready        bool   `json:"ready"`
	LastRTPAgeMS int64  `json:"lastRtpAgeMs"`
	ICEState     string `json:"iceState"`
	PeerState    string `json:"peerState"`
}

type metaHealth struct {
	Ready     bool   `json:"ready"`
	ICEState  string `json:"iceState"`
	PeerState string `json:"peerState"`
}

func newGateway(publicIP string, minPort, maxPort uint16) (*gateway, error) {
	var mediaEngine webrtc.MediaEngine
	err := mediaEngine.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
			SDPFmtpLine: "minptime=10;useinbandfec=1",
		},
		PayloadType: 111,
	}, webrtc.RTPCodecTypeAudio)
	if err != nil {
		return nil, err
	}
	var registry interceptor.Registry
	if err = webrtc.RegisterDefaultInterceptors(&mediaEngine, &registry); err != nil {
		return nil, err
	}
	var settings webrtc.SettingEngine
	if err = settings.SetEphemeralUDPPortRange(minPort, maxPort); err != nil {
		return nil, err
	}
	settings.SetICETimeouts(15*time.Second, 45*time.Second, 2*time.Second)
	settings.SetNAT1To1IPs([]string{publicIP}, webrtc.ICECandidateTypeHost)
	api := webrtc.NewAPI(
		webrtc.WithMediaEngine(&mediaEngine),
		webrtc.WithInterceptorRegistry(&registry),
		webrtc.WithSettingEngine(settings),
	)
	return &gateway{api: api, sessions: make(map[string]*callSession)}, nil
}

func cloneRTP(packet *rtp.Packet) *rtp.Packet {
	copyPacket := *packet
	copyPacket.Payload = append([]byte(nil), packet.Payload...)
	return &copyPacket
}

func drainRTCP(sender *webrtc.RTPSender) {
	go func() {
		buffer := make([]byte, 1500)
		for {
			if _, _, err := sender.Read(buffer); err != nil {
				return
			}
		}
	}()
}

func waitGathering(peer *webrtc.PeerConnection) error {
	complete := webrtc.GatheringCompletePromise(peer)
	select {
	case <-complete:
		return nil
	case <-time.After(12 * time.Second):
		return errors.New("ICE gathering timeout")
	}
}

func sdpWithPtime(sdp string) string {
	if strings.Contains(sdp, "a=ptime:20") {
		return sdp
	}
	lines := strings.Split(strings.ReplaceAll(sdp, "\r\n", "\n"), "\n")
	result := make([]string, 0, len(lines)+1)
	inserted := false
	for _, line := range lines {
		result = append(result, line)
		if !inserted && strings.HasPrefix(strings.ToLower(line), "a=rtpmap:111 opus/48000") {
			result = append(result, "a=ptime:20")
			inserted = true
		}
	}
	return strings.Join(result, "\r\n")
}

func (g *gateway) newSession(id string) (*callSession, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if _, exists := g.sessions[id]; exists {
		return nil, fmt.Errorf("session already exists")
	}
	session := &callSession{id: id, agents: make(map[string]*agentPeer), createdAt: time.Now()}
	g.sessions[id] = session
	return session, nil
}

func (g *gateway) session(id string) (*callSession, error) {
	g.mu.RLock()
	session := g.sessions[id]
	g.mu.RUnlock()
	if session == nil {
		return nil, fmt.Errorf("session not found")
	}
	return session, nil
}

func (g *gateway) bind(oldID, callID string) error {
	g.mu.Lock()
	defer g.mu.Unlock()
	session := g.sessions[oldID]
	if session == nil {
		return fmt.Errorf("session not found")
	}
	if _, exists := g.sessions[callID]; exists {
		return fmt.Errorf("call already exists")
	}
	delete(g.sessions, oldID)
	session.mu.Lock()
	session.id = callID
	session.mu.Unlock()
	g.sessions[callID] = session
	return nil
}

func (s *callSession) sessionID() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.id
}

func logPeerStates(peer *webrtc.PeerConnection, session *callSession, role, agentID string) {
	peer.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("media ice state call=%s role=%s agent=%s state=%s", session.sessionID(), role, agentID, state.String())
	})
	peer.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		log.Printf("media peer state call=%s role=%s agent=%s state=%s", session.sessionID(), role, agentID, state.String())
	})
}

func (g *gateway) closeSession(id string) {
	g.mu.Lock()
	session := g.sessions[id]
	delete(g.sessions, id)
	g.mu.Unlock()
	if session != nil {
		session.close()
	}
}

func (s *callSession) close() {
	s.mu.Lock()
	agents := make([]*webrtc.PeerConnection, 0, len(s.agents))
	for _, agent := range s.agents {
		agents = append(agents, agent.peer)
	}
	s.agents = make(map[string]*agentPeer)
	metaPeer := s.metaPeer
	s.metaPeer = nil
	s.mu.Unlock()
	for _, peer := range agents {
		_ = peer.Close()
	}
	if metaPeer != nil {
		_ = metaPeer.Close()
	}
}

func (s *callSession) relayMeta(track *webrtc.TrackRemote) {
	for {
		packet, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		s.mu.RLock()
		targets := make([]*webrtc.TrackLocalStaticRTP, 0, len(s.agents))
		for _, agent := range s.agents {
			targets = append(targets, agent.toAgent)
		}
		s.mu.RUnlock()
		for _, target := range targets {
			_ = target.WriteRTP(cloneRTP(packet))
		}
	}
}

func (s *callSession) relayAgent(agent *agentPeer, track *webrtc.TrackRemote) {
	for {
		packet, _, err := track.ReadRTP()
		if err != nil {
			agent.ready.Store(false)
			log.Printf("agent rtp stopped call=%s agent=%s error=%v", s.sessionID(), agent.id, err)
			return
		}
		if agent.ready.CompareAndSwap(false, true) {
			log.Printf("agent rtp started call=%s agent=%s", s.sessionID(), agent.id)
		}
		agent.lastRTP.Store(time.Now().UnixMilli())
		s.mu.RLock()
		current := s.currentAgent
		target := s.toMeta
		s.mu.RUnlock()
		if current == agent.id && target != nil {
			_ = target.WriteRTP(cloneRTP(packet))
		}
	}
}

func (g *gateway) configureMetaPeer(session *callSession) (*webrtc.PeerConnection, *webrtc.TrackLocalStaticRTP, error) {
	peer, err := g.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return nil, nil, err
	}
	logPeerStates(peer, session, "meta", "")
	toMeta, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
		SDPFmtpLine: "minptime=10;useinbandfec=1",
	}, "audio", "norte-sul-media")
	if err != nil {
		_ = peer.Close()
		return nil, nil, err
	}
	sender, err := peer.AddTrack(toMeta)
	if err != nil {
		_ = peer.Close()
		return nil, nil, err
	}
	drainRTCP(sender)
	peer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeAudio {
			go session.relayMeta(track)
		}
	})
	return peer, toMeta, nil
}

func (g *gateway) prepareInbound(callID, offer string) (string, error) {
	session, err := g.newSession(callID)
	if err != nil {
		return "", err
	}
	peer, toMeta, err := g.configureMetaPeer(session)
	if err != nil {
		g.closeSession(callID)
		return "", err
	}
	if err = peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		g.closeSession(callID)
		return "", err
	}
	answer, err := peer.CreateAnswer(nil)
	if err != nil {
		g.closeSession(callID)
		return "", err
	}
	if err = peer.SetLocalDescription(answer); err != nil {
		g.closeSession(callID)
		return "", err
	}
	if err = waitGathering(peer); err != nil {
		g.closeSession(callID)
		return "", err
	}
	local := sdpWithPtime(peer.LocalDescription().SDP)
	session.mu.Lock()
	session.metaPeer = peer
	session.toMeta = toMeta
	session.metaLocalSDP = local
	session.metaRemoteSDP = offer
	session.mu.Unlock()
	return local, nil
}

func (g *gateway) createProvisional(id string) error {
	_, err := g.newSession(id)
	return err
}

func (g *gateway) createMetaOffer(sessionID string) (string, error) {
	session, err := g.session(sessionID)
	if err != nil {
		return "", err
	}
	peer, toMeta, err := g.configureMetaPeer(session)
	if err != nil {
		return "", err
	}
	offer, err := peer.CreateOffer(nil)
	if err != nil {
		return "", err
	}
	if err = peer.SetLocalDescription(offer); err != nil {
		return "", err
	}
	if err = waitGathering(peer); err != nil {
		return "", err
	}
	local := sdpWithPtime(peer.LocalDescription().SDP)
	session.mu.Lock()
	session.metaPeer = peer
	session.toMeta = toMeta
	session.metaLocalSDP = local
	session.mu.Unlock()
	return local, nil
}

func (g *gateway) metaReady(callID string) (metaHealth, error) {
	session, err := g.session(callID)
	if err != nil {
		return metaHealth{}, err
	}
	session.mu.RLock()
	peer := session.metaPeer
	session.mu.RUnlock()
	if peer == nil {
		return metaHealth{}, fmt.Errorf("meta media not found")
	}
	iceState := peer.ICEConnectionState().String()
	peerState := peer.ConnectionState().String()
	return metaHealth{
		Ready:     (iceState == "connected" || iceState == "completed") && peerState == "connected",
		ICEState:  iceState,
		PeerState: peerState,
	}, nil
}

func (g *gateway) repairMeta(callID string) (string, bool, error) {
	session, err := g.session(callID)
	if err != nil {
		return "", false, err
	}
	health, err := g.metaReady(callID)
	if err == nil && health.Ready {
		session.mu.RLock()
		local := session.metaLocalSDP
		session.mu.RUnlock()
		return local, false, nil
	}
	session.mu.RLock()
	offer := session.metaRemoteSDP
	previous := session.metaPeer
	session.mu.RUnlock()
	if offer == "" {
		return "", false, fmt.Errorf("meta remote session not found")
	}
	peer, toMeta, err := g.configureMetaPeer(session)
	if err != nil {
		return "", false, err
	}
	if err = peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		_ = peer.Close()
		return "", false, err
	}
	answer, err := peer.CreateAnswer(nil)
	if err != nil {
		_ = peer.Close()
		return "", false, err
	}
	if err = peer.SetLocalDescription(answer); err != nil {
		_ = peer.Close()
		return "", false, err
	}
	if err = waitGathering(peer); err != nil {
		_ = peer.Close()
		return "", false, err
	}
	local := sdpWithPtime(peer.LocalDescription().SDP)
	session.mu.Lock()
	session.metaPeer = peer
	session.toMeta = toMeta
	session.metaLocalSDP = local
	session.mu.Unlock()
	if previous != nil && previous != peer {
		_ = previous.Close()
	}
	log.Printf("meta media repaired call=%s", callID)
	return local, true, nil
}

func (g *gateway) setMetaAnswer(callID, answer string) error {
	session, err := g.session(callID)
	if err != nil {
		return err
	}
	session.mu.RLock()
	peer := session.metaPeer
	session.mu.RUnlock()
	if peer == nil {
		return fmt.Errorf("meta peer not configured")
	}
	return peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeAnswer, SDP: answer})
}

func (g *gateway) joinAgent(sessionID, agentID, name, offer string) (string, error) {
	session, err := g.session(sessionID)
	if err != nil {
		return "", err
	}
	session.mu.RLock()
	existing := session.agents[agentID]
	session.mu.RUnlock()
	if existing != nil {
		session.mu.Lock()
		if session.agents[agentID] == existing {
			delete(session.agents, agentID)
		}
		session.mu.Unlock()
		_ = existing.peer.Close()
	}
	peer, err := g.api.NewPeerConnection(webrtc.Configuration{})
	if err != nil {
		return "", err
	}
	logPeerStates(peer, session, "agent", agentID)
	toAgent, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{
		MimeType: webrtc.MimeTypeOpus, ClockRate: 48000, Channels: 2,
		SDPFmtpLine: "minptime=10;useinbandfec=1",
	}, "customer-audio", "norte-sul-media")
	if err != nil {
		_ = peer.Close()
		return "", err
	}
	sender, err := peer.AddTrack(toAgent)
	if err != nil {
		_ = peer.Close()
		return "", err
	}
	drainRTCP(sender)
	agent := &agentPeer{id: agentID, name: name, peer: peer, toAgent: toAgent}
	peer.OnTrack(func(track *webrtc.TrackRemote, _ *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeAudio {
			go session.relayAgent(agent, track)
		}
	})
	if err = peer.SetRemoteDescription(webrtc.SessionDescription{Type: webrtc.SDPTypeOffer, SDP: offer}); err != nil {
		_ = peer.Close()
		return "", err
	}
	answer, err := peer.CreateAnswer(nil)
	if err != nil {
		_ = peer.Close()
		return "", err
	}
	if err = peer.SetLocalDescription(answer); err != nil {
		_ = peer.Close()
		return "", err
	}
	if err = waitGathering(peer); err != nil {
		_ = peer.Close()
		return "", err
	}
	session.mu.Lock()
	session.agents[agentID] = agent
	session.mu.Unlock()
	return sdpWithPtime(peer.LocalDescription().SDP), nil
}

func (g *gateway) agentReady(callID, agentID string) (agentHealth, error) {
	session, err := g.session(callID)
	if err != nil {
		return agentHealth{}, err
	}
	session.mu.RLock()
	agent := session.agents[agentID]
	session.mu.RUnlock()
	if agent == nil {
		return agentHealth{}, fmt.Errorf("agent media not found")
	}
	lastRTP := agent.lastRTP.Load()
	age := int64(-1)
	if lastRTP > 0 {
		age = time.Now().UnixMilli() - lastRTP
	}
	return agentHealth{
		Ready:        agent.ready.Load() && age >= 0 && age < 5000,
		LastRTPAgeMS: age,
		ICEState:     agent.peer.ICEConnectionState().String(),
		PeerState:    agent.peer.ConnectionState().String(),
	}, nil
}

func (g *gateway) setCurrent(callID, agentID string) (string, error) {
	session, err := g.session(callID)
	if err != nil {
		return "", err
	}
	session.mu.Lock()
	defer session.mu.Unlock()
	agent := session.agents[agentID]
	if agent == nil || !agent.ready.Load() || time.Now().UnixMilli()-agent.lastRTP.Load() >= 5000 {
		return "", fmt.Errorf("agent media not ready")
	}
	previous := session.currentAgent
	session.currentAgent = agentID
	return previous, nil
}

func (g *gateway) removeAgent(callID, agentID string) error {
	session, err := g.session(callID)
	if err != nil {
		return err
	}
	session.mu.Lock()
	agent := session.agents[agentID]
	delete(session.agents, agentID)
	if session.currentAgent == agentID {
		session.currentAgent = ""
	}
	session.mu.Unlock()
	if agent != nil {
		return agent.peer.Close()
	}
	return nil
}

type server struct {
	gateway *gateway
	token   string
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func readJSON(w http.ResponseWriter, r *http.Request, target any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

func (s *server) authorized(r *http.Request) bool {
	provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if len(provided) != len(s.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) == 1
}

func (s *server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/health" {
		writeJSON(w, 200, map[string]any{"status": "ok"})
		return
	}
	if !s.authorized(r) {
		writeJSON(w, 401, map[string]string{"error": "unauthorized"})
		return
	}
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	var err error
	switch {
	case r.Method == "POST" && r.URL.Path == "/v1/calls/inbound":
		var body struct{ CallID, Offer string }
		if err = readJSON(w, r, &body); err == nil {
			var answer string
			answer, err = s.gateway.prepareInbound(body.CallID, body.Offer)
			if err == nil {
				writeJSON(w, 201, map[string]string{"answer": answer})
				return
			}
		}
	case r.Method == "POST" && r.URL.Path == "/v1/sessions":
		var body struct{ SessionID string }
		if err = readJSON(w, r, &body); err == nil {
			err = s.gateway.createProvisional(body.SessionID)
		}
		if err == nil {
			writeJSON(w, 201, map[string]string{"sessionId": body.SessionID})
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "sessions" && parts[3] == "meta-offer" && r.Method == "POST":
		var offer string
		offer, err = s.gateway.createMetaOffer(parts[2])
		if err == nil {
			writeJSON(w, 200, map[string]string{"offer": offer})
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "sessions" && parts[3] == "bind" && r.Method == "POST":
		var body struct{ CallID string }
		if err = readJSON(w, r, &body); err == nil {
			err = s.gateway.bind(parts[2], body.CallID)
		}
		if err == nil {
			writeJSON(w, 200, map[string]bool{"success": true})
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "meta-answer" && r.Method == "POST":
		var body struct{ Answer string }
		if err = readJSON(w, r, &body); err == nil {
			err = s.gateway.setMetaAnswer(parts[2], body.Answer)
		}
		if err == nil {
			writeJSON(w, 200, map[string]bool{"success": true})
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "meta-session" && r.Method == "GET":
		var session *callSession
		session, err = s.gateway.session(parts[2])
		if err == nil {
			session.mu.RLock()
			localSDP := session.metaLocalSDP
			session.mu.RUnlock()
			if localSDP == "" {
				err = fmt.Errorf("meta session not ready")
			} else {
				health, healthErr := s.gateway.metaReady(parts[2])
				if healthErr != nil {
					err = healthErr
				} else {
					writeJSON(w, 200, map[string]any{
						"sdp": localSDP, "ready": health.Ready,
						"iceState": health.ICEState, "peerState": health.PeerState,
					})
					return
				}
			}
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "meta-repair" && r.Method == "POST":
		var local string
		var repaired bool
		local, repaired, err = s.gateway.repairMeta(parts[2])
		if err == nil {
			writeJSON(w, 200, map[string]any{"sdp": local, "repaired": repaired})
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "agents" && r.Method == "POST":
		var body struct{ AgentID, AgentName, Offer string }
		if err = readJSON(w, r, &body); err == nil {
			var answer string
			answer, err = s.gateway.joinAgent(parts[2], body.AgentID, body.AgentName, body.Offer)
			if err == nil {
				writeJSON(w, 201, map[string]string{"answer": answer})
				return
			}
		}
	case len(parts) == 6 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "agents" && parts[5] == "ready" && r.Method == "GET":
		var health agentHealth
		health, err = s.gateway.agentReady(parts[2], parts[4])
		if err == nil {
			writeJSON(w, 200, health)
			return
		}
	case len(parts) == 4 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "current-agent" && r.Method == "POST":
		var body struct{ AgentID string }
		if err = readJSON(w, r, &body); err == nil {
			var previous string
			previous, err = s.gateway.setCurrent(parts[2], body.AgentID)
			if err == nil {
				writeJSON(w, 200, map[string]string{"previousAgentId": previous})
				return
			}
		}
	case len(parts) == 5 && parts[0] == "v1" && parts[1] == "calls" && parts[3] == "agents" && r.Method == "DELETE":
		err = s.gateway.removeAgent(parts[2], parts[4])
		if err == nil {
			writeJSON(w, 200, map[string]bool{"success": true})
			return
		}
	case len(parts) == 3 && parts[0] == "v1" && parts[1] == "calls" && r.Method == "DELETE":
		s.gateway.closeSession(parts[2])
		writeJSON(w, 200, map[string]bool{"success": true})
		return
	default:
		writeJSON(w, 404, map[string]string{"error": "not_found"})
		return
	}
	log.Printf("media request failed path=%s error=%v", r.URL.Path, err)
	writeJSON(w, 409, map[string]string{"error": "media_operation_failed"})
}

func required(name string) string {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		log.Fatalf("missing environment variable %s", name)
	}
	return value
}

func port(name string, fallback uint16) uint16 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	number, err := strconv.ParseUint(value, 10, 16)
	if err != nil {
		log.Fatalf("invalid %s", name)
	}
	return uint16(number)
}

func main() {
	publicIP := required("MEDIA_PUBLIC_IP")
	token := required("MEDIA_GATEWAY_TOKEN")
	gateway, err := newGateway(publicIP, port("MEDIA_UDP_MIN_PORT", 40000), port("MEDIA_UDP_MAX_PORT", 40100))
	if err != nil {
		log.Fatal(err)
	}
	httpServer := &http.Server{
		Addr:              "127.0.0.1:" + strings.TrimSpace(os.Getenv("MEDIA_HTTP_PORT")),
		Handler:           &server{gateway: gateway, token: token},
		ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 20 * time.Second,
	}
	if httpServer.Addr == "127.0.0.1:" {
		httpServer.Addr = "127.0.0.1:3025"
	}
	go func() {
		log.Printf("media gateway started http=%s udp=%d-%d", httpServer.Addr, port("MEDIA_UDP_MIN_PORT", 40000), port("MEDIA_UDP_MAX_PORT", 40100))
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	gateway.mu.RLock()
	ids := make([]string, 0, len(gateway.sessions))
	for id := range gateway.sessions {
		ids = append(ids, id)
	}
	gateway.mu.RUnlock()
	for _, id := range ids {
		gateway.closeSession(id)
	}
}
