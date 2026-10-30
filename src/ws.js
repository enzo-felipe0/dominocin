// Servidor WebSocket mínimo (RFC 6455) sobre o módulo http do Node.
// Suporta apenas o necessário para o jogo: frames de texto, ping/pong, close e
// fragmentação. Sem dependências externas.

import crypto from 'node:crypto';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_PAYLOAD = 1 << 20; // 1 MB

export function attachWebSocketServer(httpServer, onConnection) {
  httpServer.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    onConnection(makeClient(socket, req));
  });
}

function makeClient(socket, req) {
  const client = {
    socket,
    req,
    alive: true,
    buffer: Buffer.alloc(0),
    fragments: [],
    onmessage: () => {},
    onclose: () => {},
    send(data) {
      if (!client.alive) return;
      const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data), 'utf8');
      socket.write(encodeFrame(0x1, payload));
    },
    close(code = 1000, reason = '') {
      if (!client.alive) return;
      try {
        const payload = Buffer.alloc(2 + Buffer.byteLength(reason));
        payload.writeUInt16BE(code, 0);
        payload.write(reason, 2);
        socket.write(encodeFrame(0x8, payload));
      } catch { /* socket já morto */ }
      client.alive = false;
      socket.end();
    },
  };

  socket.on('data', (chunk) => {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    try {
      parseFrames(client);
    } catch (err) {
      client.close(1002, 'protocol error');
      cleanup();
    }
  });

  const cleanup = () => {
    if (!client.alive) { client.onclose(); return; }
    client.alive = false;
    client.onclose();
  };
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  socket.on('end', cleanup);

  return client;
}

function parseFrames(client) {
  while (client.buffer.length >= 2) {
    const b0 = client.buffer[0];
    const b1 = client.buffer[1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let len = b1 & 0x7f;
    let offset = 2;

    if (len === 126) {
      if (client.buffer.length < 4) return;
      len = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (client.buffer.length < 10) return;
      const big = client.buffer.readBigUInt64BE(2);
      if (big > BigInt(MAX_PAYLOAD)) throw new Error('payload too large');
      len = Number(big);
      offset = 10;
    }
    if (len > MAX_PAYLOAD) throw new Error('payload too large');

    const maskLen = masked ? 4 : 0;
    if (client.buffer.length < offset + maskLen + len) return;

    const maskKey = masked ? client.buffer.subarray(offset, offset + 4) : null;
    const dataStart = offset + maskLen;
    const payload = Buffer.from(client.buffer.subarray(dataStart, dataStart + len));
    if (maskKey) {
      for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i & 3];
    }
    client.buffer = client.buffer.subarray(dataStart + len);

    if (opcode === 0x8) { // close
      client.close(1000, '');
      return;
    }
    if (opcode === 0x9) { // ping
      client.socket.write(encodeFrame(0xA, payload));
      continue;
    }
    if (opcode === 0xA) continue; // pong

    if (opcode === 0x0) { // continuação
      client.fragments.push(payload);
      if (fin) {
        const full = Buffer.concat(client.fragments).toString('utf8');
        client.fragments = [];
        client.onmessage(full);
      }
      continue;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (!fin) { client.fragments = [payload]; continue; }
      client.onmessage(payload.toString('utf8'));
      continue;
    }
    throw new Error('opcode desconhecido');
  }
}

function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}
