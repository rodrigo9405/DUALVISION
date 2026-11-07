// Cámara y micrófono entre participantes (WebRTC en malla, hasta 4 personas).
// Cada conexión se negocia una sola vez con un canal de audio y uno de video;
// prender o apagar la cámara solo cambia la pista, sin renegociar.

export class Mesh {
  constructor({ myId, iceServers, send, onStream, onState }) {
    this.myId = myId;
    this.iceServers = iceServers;
    this.send = send;
    this.onStream = onStream;
    this.onState = onState;
    this.peers = new Map();
    this.attempts = new Map();
    this.local = { audio: null, video: null };
  }

  isInitiator(peerId) {
    return this.myId < peerId;
  }

  sync(ids) {
    for (const id of ids) {
      if (!this.peers.has(id) && (this.attempts.get(id) || 0) <= 3) this._create(id, this.isInitiator(id));
    }
    for (const id of [...this.peers.keys()]) {
      if (!ids.includes(id)) { this.close(id); this.attempts.delete(id); }
    }
  }

  _create(id, makeOffer) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer = { id, pc, stream: new MediaStream(), tx: {}, queue: [], timer: null };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ to: id, ice: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      this.onStream(id, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') this.attempts.set(id, 0);
      this.onState(id, s);
      if (s === 'failed') this._restart(id);
    };

    if (makeOffer) {
      peer.tx.audio = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.tx.video = pc.addTransceiver('video', { direction: 'sendrecv' });
      this._attach(peer);
      this._offer(peer);
    } else {
      // Si la oferta no llega, se la pedimos al otro lado.
      peer.timer = setTimeout(() => {
        if (this.peers.get(id) === peer && !pc.remoteDescription) this.send({ to: id, poke: true });
      }, 6000);
    }
    this.onStream(id, peer.stream);
    this.onState(id, 'connecting');
    return peer;
  }

  async _offer(peer) {
    try {
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send({ to: peer.id, sdp: peer.pc.localDescription.toJSON() });
    } catch (err) {
      console.warn('[DualVision] oferta', err);
    }
    clearTimeout(peer.timer);
    peer.timer = setTimeout(() => {
      if (this.peers.get(peer.id) === peer && peer.pc.connectionState !== 'connected') this._restart(peer.id);
    }, 20000);
  }

  _attach(peer) {
    for (const kind of ['audio', 'video']) {
      const t = peer.tx[kind];
      if (t && t.sender) t.sender.replaceTrack(this.local[kind]).catch(() => {});
    }
  }

  async onSignal(msg) {
    if (!msg || msg.to !== this.myId) return;
    const id = msg.from;
    try {
      if (msg.restart) {
        this.close(id);
        this._create(id, this.isInitiator(id));
        return;
      }
      if (msg.poke) {
        if (this.isInitiator(id)) this._restart(id);
        return;
      }
      let peer = this.peers.get(id);
      if (msg.sdp && msg.sdp.type === 'offer') {
        if (!peer || peer.pc.remoteDescription) {
          if (peer) this.close(id);
          peer = this._create(id, false);
        }
        clearTimeout(peer.timer);
        await peer.pc.setRemoteDescription(msg.sdp);
        for (const t of peer.pc.getTransceivers()) {
          const kind = t.receiver && t.receiver.track && t.receiver.track.kind;
          if (!kind) continue;
          t.direction = 'sendrecv';
          peer.tx[kind] = t;
        }
        this._attach(peer);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send({ to: id, sdp: peer.pc.localDescription.toJSON() });
        this._flush(peer);
      } else if (msg.sdp && msg.sdp.type === 'answer') {
        if (peer && peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setRemoteDescription(msg.sdp);
          this._flush(peer);
        }
      } else if (msg.ice && peer) {
        if (peer.pc.remoteDescription) peer.pc.addIceCandidate(msg.ice).catch(() => {});
        else peer.queue.push(msg.ice);
      }
    } catch (err) {
      console.warn('[DualVision] señal', err);
    }
  }

  _flush(peer) {
    for (const c of peer.queue.splice(0)) peer.pc.addIceCandidate(c).catch(() => {});
  }

  _restart(id) {
    if (!this.peers.has(id)) return;
    if (!this.isInitiator(id)) {
      this.send({ to: id, poke: true });
      return;
    }
    const n = (this.attempts.get(id) || 0) + 1;
    this.attempts.set(id, n);
    this.close(id);
    if (n > 3) {
      this.onState(id, 'failed');
      return;
    }
    this.send({ to: id, restart: true });
    this._create(id, true);
  }

  setTrack(kind, track) {
    this.local[kind] = track;
    for (const peer of this.peers.values()) {
      const t = peer.tx[kind];
      if (t && t.sender) t.sender.replaceTrack(track).catch(() => {});
    }
  }

  close(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    clearTimeout(peer.timer);
    try { peer.pc.close(); } catch {}
    this.peers.delete(id);
    this.onStream(id, null);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
  }
}
