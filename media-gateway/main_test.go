package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"github.com/pion/rtp"
)

func TestTransferPreservesRTPContinuity(t *testing.T) {
	a, b := &agentPeer{id: "a"}, &agentPeer{id: "b"}
	var continuity rtpContinuity
	first := continuity.rewrite(a, &rtp.Packet{Header: rtp.Header{SequenceNumber: 65535, Timestamp: 50000}})
	next := continuity.rewrite(b, &rtp.Packet{Header: rtp.Header{SequenceNumber: 120, Timestamp: 900000}})
	if next.SequenceNumber != 0 || next.Timestamp != first.Timestamp+960 {
		t.Fatal("transfer broke sequence or audio clock")
	}
	next = continuity.rewrite(b, &rtp.Packet{Header: rtp.Header{SequenceNumber: 121, Timestamp: 900960}})
	if next.SequenceNumber != 1 || next.Timestamp != 51920 {
		t.Fatal("new source clock did not advance normally")
	}
}

func TestRelayStripsExtensionsFromOtherPeer(t *testing.T) {
	packet := &rtp.Packet{Header: rtp.Header{Version: 2}, Payload: []byte{1}}
	if err := packet.SetExtension(1, []byte{123}); err != nil { t.Fatal(err) }
	out := cloneRTP(packet)
	if out.Extension || len(out.Extensions) != 0 { t.Fatal("foreign SDP extensions forwarded") }
	if !packet.Extension { t.Fatal("original packet mutated") }
}

func TestSDPWithPtime(t *testing.T) {
	sdp := "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n"
	result := sdpWithPtime(sdp)
	if strings.Count(result, "a=ptime:20") != 1 {
		t.Fatalf("expected one ptime attribute, got %q", result)
	}
	if strings.Count(sdpWithPtime(result), "a=ptime:20") != 1 {
		t.Fatal("ptime insertion must be idempotent")
	}
}

func TestServerAuthorizationAndHealth(t *testing.T) {
	handler := &server{token: "token-comprido-de-teste", gateway: &gateway{sessions: make(map[string]*callSession)}}

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health returned %d", health.Code)
	}

	unauthorized := httptest.NewRecorder()
	handler.ServeHTTP(unauthorized, httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(`{"SessionID":"one"}`)))
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized request returned %d", unauthorized.Code)
	}

	authorizedRequest := httptest.NewRequest(http.MethodPost, "/v1/sessions", strings.NewReader(`{"SessionID":"one"}`))
	authorizedRequest.Header.Set("Authorization", "Bearer token-comprido-de-teste")
	authorized := httptest.NewRecorder()
	handler.ServeHTTP(authorized, authorizedRequest)
	if authorized.Code != http.StatusCreated {
		t.Fatalf("authorized request returned %d: %s", authorized.Code, authorized.Body.String())
	}
}

func TestSessionBindPreservesSession(t *testing.T) {
	g := &gateway{sessions: make(map[string]*callSession)}
	created, err := g.newSession("temporary")
	if err != nil {
		t.Fatal(err)
	}
	if err = g.bind("temporary", "call-1"); err != nil {
		t.Fatal(err)
	}
	bound, err := g.session("call-1")
	if err != nil || bound != created || bound.id != "call-1" {
		t.Fatal("bound call did not preserve the media session")
	}
	if _, err = g.session("temporary"); err == nil {
		t.Fatal("temporary session should no longer exist")
	}
}

func TestExpireProvisionalDiscardsAbandonedSession(t *testing.T) {
	g := &gateway{sessions: make(map[string]*callSession)}
	session, err := g.newSession("temporary")
	if err != nil {
		t.Fatal(err)
	}
	g.expireProvisional("temporary", session)
	if _, err = g.session("temporary"); err == nil {
		t.Fatal("abandoned provisional session must be removed")
	}
}

func TestExpireProvisionalPreservesBoundAndReplacementSessions(t *testing.T) {
	g := &gateway{sessions: make(map[string]*callSession)}
	session, err := g.newSession("temporary")
	if err != nil {
		t.Fatal(err)
	}
	if err = g.bind("temporary", "call-active"); err != nil {
		t.Fatal(err)
	}
	g.expireProvisional("temporary", session)
	if current, err := g.session("call-active"); err != nil || current != session {
		t.Fatal("expiration must preserve the bound call")
	}
	replacement, err := g.newSession("temporary")
	if err != nil {
		t.Fatal(err)
	}
	g.expireProvisional("temporary", session)
	if current, err := g.session("temporary"); err != nil || current != replacement {
		t.Fatal("expiration must preserve a replacement session")
	}
}

func TestConcurrentCallsUseIsolatedSessions(t *testing.T) {
	g := &gateway{sessions: make(map[string]*callSession)}
	first, err := g.newSession("call-channel-a")
	if err != nil {
		t.Fatal(err)
	}
	second, err := g.newSession("call-channel-b")
	if err != nil {
		t.Fatal(err)
	}
	if first == second || first.sessionID() == second.sessionID() {
		t.Fatal("concurrent calls must not share their media session")
	}
	if len(g.sessions) != 2 {
		t.Fatalf("expected two active sessions, got %d", len(g.sessions))
	}
}
