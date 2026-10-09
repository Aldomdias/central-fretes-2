import { inflateSync } from 'fflate';

// Leitor de .zip pelo diretorio central (EOCD). O unzipSync da versao do fflate
// do projeto falha em zips com "data descriptor" (gerados por varios exportadores).
export function lerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo .zip invalido.');
  const total = dv.getUint16(eocd + 10, true);
  let pos = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder('utf-8');
  const arquivos = {};
  for (let n = 0; n < total; n += 1) {
    if (dv.getUint32(pos, true) !== 0x02014b50) break;
    const metodo = dv.getUint16(pos + 10, true);
    const tamComp = dv.getUint32(pos + 20, true);
    const nomeLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const comLen = dv.getUint16(pos + 32, true);
    const offLocal = dv.getUint32(pos + 42, true);
    const nome = dec.decode(bytes.subarray(pos + 46, pos + 46 + nomeLen));
    pos += 46 + nomeLen + extraLen + comLen;
    if (nome.endsWith('/')) continue;
    const ini = offLocal + 30 + dv.getUint16(offLocal + 26, true) + dv.getUint16(offLocal + 28, true);
    const comp = bytes.subarray(ini, ini + tamComp);
    if (metodo === 0) arquivos[nome] = comp;
    else if (metodo === 8) arquivos[nome] = inflateSync(comp);
  }
  return arquivos;
}
