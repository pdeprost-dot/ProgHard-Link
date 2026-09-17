const HEADER_LIMIT = 8192;
const CHUNK_SIZE = 512;

export function multipartBoundary(contentType) {
  const match = /^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))$/i.exec(contentType || "");
  const boundary = match?.[1] || match?.[2];
  return boundary && boundary.length <= 70 ? boundary : null;
}

export async function* firmwareParts(request, boundary, maximumBytes) {
  const marker = Buffer.from(`\r\n--${boundary}`);
  let buffered = Buffer.alloc(0);
  let total = 0;
  let headersDone = false;
  let ended = false;
  let firmwareBytes = 0;
  const emit = function* (data) {
    firmwareBytes += data.length;
    if (firmwareBytes > maximumBytes)
      throw Object.assign(new Error("ota_too_large"), { statusCode: 413 });
    for (let offset = 0; offset < data.length; offset += CHUNK_SIZE)
      yield data.subarray(offset, Math.min(offset + CHUNK_SIZE, data.length));
  };
  for await (const incoming of request) {
    total += incoming.length;
    if (total > maximumBytes + HEADER_LIMIT) throw Object.assign(new Error("ota_too_large"), { statusCode: 413 });
    buffered = Buffer.concat([buffered, incoming]);
    if (!headersDone) {
      const end = buffered.indexOf("\r\n\r\n");
      if (end < 0) {
        if (buffered.length > HEADER_LIMIT) throw Object.assign(new Error("invalid_multipart"), { statusCode: 400 });
        continue;
      }
      const header = buffered.subarray(0, end).toString("utf8");
      if (!header.startsWith(`--${boundary}\r\n`) || !/name="update"/i.test(header))
        throw Object.assign(new Error("invalid_multipart"), { statusCode: 400 });
      buffered = buffered.subarray(end + 4);
      headersDone = true;
    }
    const end = buffered.indexOf(marker);
    if (end >= 0) {
      yield* emit(buffered.subarray(0, end));
      ended = true;
      buffered = Buffer.alloc(0);
      break;
    }
    const safe = buffered.length - marker.length - 4;
    if (safe > 0) {
      yield* emit(buffered.subarray(0, safe));
      buffered = buffered.subarray(safe);
    }
  }
  if (!headersDone || !ended) throw Object.assign(new Error("invalid_multipart"), { statusCode: 400 });
}

export const OTA_CHUNK_SIZE = CHUNK_SIZE;
