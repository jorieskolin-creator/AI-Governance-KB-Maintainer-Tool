import { inflateSync } from 'node:zlib';

export interface ExtractedPdfPage {
  pageNumber: number;
  text: string;
  hasImages: boolean;
  characterCount: number;
}

export interface PdfExtractionResult {
  pageCount: number;
  pages: ExtractedPdfPage[];
  status: 'COMPLETE' | 'PARTIAL_TRUNCATED' | 'SCANNED_UNSUPPORTED' | 'FAILED';
  warnings: string[];
}

export interface ExtractedPairCriteria {
  pair_id: string;
  page_number: number;
  locator: string;
  capability_id: string;
  capability_title: string;
  capability_definition: string;
  applicability: string;
  capability_indicators: string[];
  antipattern_id: string;
  antipattern_title: string;
  antipattern_definition: string;
  antipattern_indicators: string[];
}

const WIN_ANSI_EXTENDED: Record<number, string> = {
  0x80: '€',
  0x82: '‚',
  0x83: 'ƒ',
  0x84: '„',
  0x85: '…',
  0x86: '†',
  0x87: '‡',
  0x88: 'ˆ',
  0x89: '‰',
  0x8a: 'Š',
  0x8b: '‹',
  0x8c: 'Œ',
  0x8e: 'Ž',
  0x91: '‘',
  0x92: '’',
  0x93: '“',
  0x94: '”',
  0x95: '•',
  0x96: '–',
  0x97: '—',
  0x98: '˜',
  0x99: '™',
  0x9a: 'š',
  0x9b: '›',
  0x9c: 'œ',
  0x9e: 'ž',
  0x9f: 'Ÿ'
};

function decodeWinAnsi(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    if (byte >= 0x80 && byte <= 0x9f) {
      out += WIN_ANSI_EXTENDED[byte] ?? String.fromCharCode(byte);
    } else {
      out += String.fromCharCode(byte);
    }
  }
  return out;
}

function decodeAscii85(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (ch === 0x7e && input[i + 1] === 0x3e) {
      // '~>' end-of-data marker
      break;
    }
    if (ch <= 0x20) continue; // whitespace
    if (ch === 0x7a) {
      // 'z' = four zero bytes
      if (count !== 0) break;
      out.push(0, 0, 0, 0);
      continue;
    }
    if (ch < 0x21 || ch > 0x75) continue;
    tuple = tuple * 85 + (ch - 0x21);
    count += 1;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }

  if (count > 1) {
    for (let p = count; p < 5; p += 1) {
      tuple = tuple * 85 + 84;
    }
    for (let b = 0; b < count - 1; b += 1) {
      out.push((tuple >>> (24 - b * 8)) & 0xff);
    }
  }

  return new Uint8Array(out);
}

interface RawPdfObject {
  objNum: number;
  dictText: string;
  streamBytes: Uint8Array | null;
}

function parsePdfObjects(pdfBytes: Uint8Array): Map<number, RawPdfObject> {
  const objects = new Map<number, RawPdfObject>();
  const latin1 = Buffer.from(pdfBytes).toString('latin1');
  const objHeaderRegex = /(?:^|[\r\n\s])(\d+)\s+(\d+)\s+obj\b/g;

  let match: RegExpExecArray | null;
  while ((match = objHeaderRegex.exec(latin1)) !== null) {
    const objNum = Number(match[1]);
    const bodyStart = match.index + match[0].length;
    const endObjIdx = latin1.indexOf('endobj', bodyStart);
    if (endObjIdx === -1) continue;

    const rawBody = latin1.slice(bodyStart, endObjIdx);
    const streamMatch = /stream(?:\r\n|\n)/.exec(rawBody);
    if (!streamMatch) {
      objects.set(objNum, {
        objNum,
        dictText: rawBody,
        streamBytes: null
      });
      continue;
    }

    const dictText = rawBody.slice(0, streamMatch.index);
    const streamDataStart = bodyStart + streamMatch.index + streamMatch[0].length;
    let streamDataEnd = latin1.lastIndexOf('endstream', endObjIdx);
    if (streamDataEnd === -1 || streamDataEnd < streamDataStart) {
      streamDataEnd = endObjIdx;
    }
    // Trim trailing EOL right before endstream.
    if (pdfBytes[streamDataEnd - 1] === 0x0a) {
      streamDataEnd -= 1;
      if (pdfBytes[streamDataEnd - 1] === 0x0d) {
        streamDataEnd -= 1;
      }
    } else if (pdfBytes[streamDataEnd - 1] === 0x0d) {
      streamDataEnd -= 1;
    }

    objects.set(objNum, {
      objNum,
      dictText,
      streamBytes: pdfBytes.subarray(streamDataStart, streamDataEnd)
    });
  }

  return objects;
}

function decodePdfStream(obj: RawPdfObject, maxInflateBytes: number): Uint8Array | null {
  if (!obj.streamBytes) return null;
  let data: Uint8Array = obj.streamBytes;
  const filterArrayMatch = obj.dictText.match(/\/Filter\s*\[([^\]]+)\]/);
  const singleFilterMatch = obj.dictText.match(/\/Filter\s*\/([A-Za-z0-9]+)/);
  const filters = filterArrayMatch
    ? [...filterArrayMatch[1]!.matchAll(/\/([A-Za-z0-9]+)/g)].map((m) => m[1]!)
    : singleFilterMatch
      ? [singleFilterMatch[1]!]
      : [];

  for (const filter of filters) {
    if (filter === 'ASCII85Decode') {
      data = decodeAscii85(data);
    } else if (filter === 'FlateDecode') {
      try {
        data = new Uint8Array(inflateSync(data, { maxOutputLength: maxInflateBytes }));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }
  return data;
}

interface CMapDecoder {
  codeByteWidth: 1 | 2;
  map: Map<number, string>;
}

function hexToUnicodeString(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  if (clean.length === 0) return '';
  if (clean.length % 4 === 0) {
    const codeUnits: number[] = [];
    for (let i = 0; i < clean.length; i += 4) {
      codeUnits.push(Number.parseInt(clean.slice(i, i + 4), 16));
    }
    return String.fromCharCode(...codeUnits);
  }
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(Number.parseInt(clean.slice(i, i + 2), 16));
  }
  return Buffer.from(bytes).toString('utf16le');
}

function parseToUnicodeCMap(cmapText: string): CMapDecoder {
  const map = new Map<number, string>();
  let codeByteWidth: 1 | 2 = 1;

  const codespaceMatch = cmapText.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (codespaceMatch) {
    const firstHex = codespaceMatch[1]!.match(/<([0-9A-Fa-f]+)>/);
    if (firstHex && firstHex[1]!.length >= 4) {
      codeByteWidth = 2;
    }
  }

  for (const block of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (pair[1]!.length >= 4) codeByteWidth = 2;
      map.set(Number.parseInt(pair[1]!, 16), hexToUnicodeString(pair[2]!));
    }
  }

  for (const block of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const lines = block[1]!.split(/\r?\n/);
    for (const line of lines) {
      const direct = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/);
      if (direct) {
        if (direct[1]!.length >= 4) codeByteWidth = 2;
        const start = Number.parseInt(direct[1]!, 16);
        const end = Number.parseInt(direct[2]!, 16);
        const baseUnicode = hexToUnicodeString(direct[3]!);
        const prefix = baseUnicode.slice(0, -1);
        const baseCharCode = baseUnicode.charCodeAt(baseUnicode.length - 1);
        for (let code = start; code <= end && code - start <= 1024; code += 1) {
          map.set(code, prefix + String.fromCharCode(baseCharCode + (code - start)));
        }
        continue;
      }
      const arrMatch = line.match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([^\]]+)\]/);
      if (arrMatch) {
        if (arrMatch[1]!.length >= 4) codeByteWidth = 2;
        const start = Number.parseInt(arrMatch[1]!, 16);
        const end = Number.parseInt(arrMatch[2]!, 16);
        const targets = [...arrMatch[3]!.matchAll(/<([0-9A-Fa-f]+)>/g)].map((m) =>
          hexToUnicodeString(m[1]!)
        );
        for (let code = start; code <= end && code - start < targets.length; code += 1) {
          map.set(code, targets[code - start]!);
        }
      }
    }
  }

  return { codeByteWidth, map };
}

function decodeGlyphBytes(bytes: Uint8Array, cmap: CMapDecoder | undefined): string {
  if (!cmap || cmap.map.size === 0) {
    return decodeWinAnsi(bytes);
  }
  if (cmap.codeByteWidth === 2 && bytes.length >= 2 && bytes.length % 2 === 0) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 2) {
      const code = (bytes[i]! << 8) | bytes[i + 1]!;
      out += cmap.map.get(code) ?? '';
    }
    return out;
  }
  let out = '';
  for (const byte of bytes) {
    out += cmap.map.get(byte) ?? decodeWinAnsi(Uint8Array.of(byte));
  }
  return out;
}

function parsePdfLiteralString(src: string, startIdx: number): { bytes: Uint8Array; nextIdx: number } {
  const bytes: number[] = [];
  let depth = 1;
  let i = startIdx + 1; // skip '('

  while (i < src.length && depth > 0) {
    const ch = src[i]!;
    if (ch === '\\') {
      i += 1;
      if (i >= src.length) break;
      const esc = src[i]!;
      if (esc >= '0' && esc <= '7') {
        let octal = esc;
        if (i + 1 < src.length && src[i + 1]! >= '0' && src[i + 1]! <= '7') {
          octal += src[++i]!;
          if (i + 1 < src.length && src[i + 1]! >= '0' && src[i + 1]! <= '7') {
            octal += src[++i]!;
          }
        }
        bytes.push(Number.parseInt(octal, 8) & 0xff);
      } else if (esc === 'n') {
        bytes.push(0x0a);
      } else if (esc === 'r') {
        bytes.push(0x0d);
      } else if (esc === 't') {
        bytes.push(0x09);
      } else if (esc === 'b') {
        bytes.push(0x08);
      } else if (esc === 'f') {
        bytes.push(0x0c);
      } else if (esc === '\r') {
        if (src[i + 1] === '\n') i += 1;
      } else if (esc === '\n') {
        // line continuation
      } else {
        bytes.push(esc.charCodeAt(0) & 0xff);
      }
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      bytes.push(0x28);
    } else if (ch === ')') {
      depth -= 1;
      if (depth > 0) bytes.push(0x29);
    } else {
      bytes.push(ch.charCodeAt(0) & 0xff);
    }
    i += 1;
  }

  return { bytes: new Uint8Array(bytes), nextIdx: i };
}

function parsePdfHexString(src: string, startIdx: number): { bytes: Uint8Array; nextIdx: number } {
  const endIdx = src.indexOf('>', startIdx + 1);
  const rawHex = (endIdx === -1 ? src.slice(startIdx + 1) : src.slice(startIdx + 1, endIdx)).replace(
    /\s+/g,
    ''
  );
  const padded = rawHex.length % 2 === 1 ? `${rawHex}0` : rawHex;
  const out = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    out[i / 2] = Number.parseInt(padded.slice(i, i + 2), 16) || 0;
  }
  return { bytes: out, nextIdx: endIdx === -1 ? src.length : endIdx + 1 };
}

type StreamToken =
  | { kind: 'string'; bytes: Uint8Array }
  | { kind: 'array'; items: StreamToken[] }
  | { kind: 'name'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'op'; value: string };

function tokenizeContentStream(src: string): StreamToken[] {
  const tokens: StreamToken[] = [];
  let i = 0;

  while (i < src.length) {
    const ch = src[i]!;
    if (ch <= ' ') {
      i += 1;
      continue;
    }
    if (ch === '%') {
      while (i < src.length && src[i] !== '\n' && src[i] !== '\r') i += 1;
      continue;
    }
    if (ch === '<' && src[i + 1] === '<') {
      i += 2;
      continue;
    }
    if (ch === '>' && src[i + 1] === '>') {
      i += 2;
      continue;
    }
    if (ch === '(') {
      const parsed = parsePdfLiteralString(src, i);
      tokens.push({ kind: 'string', bytes: parsed.bytes });
      i = parsed.nextIdx;
      continue;
    }
    if (ch === '<') {
      const parsed = parsePdfHexString(src, i);
      tokens.push({ kind: 'string', bytes: parsed.bytes });
      i = parsed.nextIdx;
      continue;
    }
    if (ch === '[') {
      i += 1;
      const items: StreamToken[] = [];
      while (i < src.length) {
        while (i < src.length && src[i]! <= ' ') i += 1;
        if (i >= src.length || src[i] === ']') {
          i += 1;
          break;
        }
        if (src[i] === '(') {
          const parsed = parsePdfLiteralString(src, i);
          items.push({ kind: 'string', bytes: parsed.bytes });
          i = parsed.nextIdx;
        } else if (src[i] === '<' && src[i + 1] !== '<') {
          const parsed = parsePdfHexString(src, i);
          items.push({ kind: 'string', bytes: parsed.bytes });
          i = parsed.nextIdx;
        } else {
          let end = i;
          while (end < src.length && src[end]! > ' ' && !'[]()<>'.includes(src[end]!)) end += 1;
          const word = src.slice(i, end);
          const num = Number(word);
          if (!Number.isNaN(num)) {
            items.push({ kind: 'number', value: num });
          }
          i = end === i ? i + 1 : end;
        }
      }
      tokens.push({ kind: 'array', items });
      continue;
    }
    if (ch === '/') {
      let end = i + 1;
      while (end < src.length && src[end]! > ' ' && !'/[]()<>'.includes(src[end]!)) end += 1;
      tokens.push({ kind: 'name', value: src.slice(i, end) });
      i = end;
      continue;
    }
    let end = i;
    while (end < src.length && src[end]! > ' ' && !'/[]()<>'.includes(src[end]!)) end += 1;
    const word = src.slice(i, end);
    const num = Number(word);
    if (!Number.isNaN(num) && word.length > 0) {
      tokens.push({ kind: 'number', value: num });
    } else if (word.length > 0) {
      tokens.push({ kind: 'op', value: word });
    }
    i = end === i ? i + 1 : end;
  }

  return tokens;
}

function renderContentStreamText(contentLatin1: string, fonts: Map<string, CMapDecoder | undefined>): string {
  const tokens = tokenizeContentStream(contentLatin1);
  const operands: StreamToken[] = [];
  let currentFont = '';
  let lastY: number | null = null;
  const lines: string[] = [];
  let currentLine = '';

  const flushLine = () => {
    const trimmed = currentLine.replace(/[ \t]+/g, ' ').trim();
    if (trimmed.length > 0) {
      lines.push(trimmed);
    }
    currentLine = '';
  };

  const appendText = (chunk: string) => {
    if (!chunk) return;
    currentLine += chunk;
  };

  for (const token of tokens) {
    if (token.kind !== 'op') {
      operands.push(token);
      continue;
    }

    const op = token.value;
    if (op === 'BT') {
      // Begin text object
    } else if (op === 'Tf' && operands.length >= 2) {
      const fontTok = operands[operands.length - 2];
      if (fontTok?.kind === 'name') {
        currentFont = fontTok.value;
      }
    } else if (op === 'Tm' && operands.length >= 6) {
      const yTok = operands[operands.length - 1];
      if (yTok?.kind === 'number') {
        if (lastY !== null && Math.abs(yTok.value - lastY) > 2.5) {
          flushLine();
        }
        lastY = yTok.value;
      }
    } else if ((op === 'Td' || op === 'TD') && operands.length >= 2) {
      const tyTok = operands[operands.length - 1];
      if (tyTok?.kind === 'number' && Math.abs(tyTok.value) > 0.5) {
        flushLine();
        if (lastY !== null) lastY += tyTok.value;
      }
    } else if (op === 'T*') {
      flushLine();
    } else if (op === 'Tj' && operands.length >= 1) {
      const strTok = operands[operands.length - 1];
      if (strTok?.kind === 'string') {
        appendText(decodeGlyphBytes(strTok.bytes, fonts.get(currentFont)));
      }
    } else if (op === "'" && operands.length >= 1) {
      flushLine();
      const strTok = operands[operands.length - 1];
      if (strTok?.kind === 'string') {
        appendText(decodeGlyphBytes(strTok.bytes, fonts.get(currentFont)));
      }
    } else if (op === '"' && operands.length >= 3) {
      flushLine();
      const strTok = operands[operands.length - 1];
      if (strTok?.kind === 'string') {
        appendText(decodeGlyphBytes(strTok.bytes, fonts.get(currentFont)));
      }
    } else if (op === 'TJ' && operands.length >= 1) {
      const arrTok = operands[operands.length - 1];
      if (arrTok?.kind === 'array') {
        const cmap = fonts.get(currentFont);
        for (const item of arrTok.items) {
          if (item.kind === 'string') {
            appendText(decodeGlyphBytes(item.bytes, cmap));
          } else if (item.kind === 'number' && item.value < -120) {
            if (!currentLine.endsWith(' ')) {
              appendText(' ');
            }
          }
        }
      }
    }
    operands.length = 0;
  }

  flushLine();
  return lines.join('\n');
}

function resolveDictBlock(dictText: string, key: string, objects: Map<number, RawPdfObject>): string | null {
  const refMatch = dictText.match(new RegExp(`${key}\\s+(\\d+)\\s+\\d+\\s+R\\b`));
  if (refMatch) {
    return objects.get(Number(refMatch[1]))?.dictText ?? null;
  }
  const idx = dictText.indexOf(key);
  if (idx === -1) return null;
  const openIdx = dictText.indexOf('<<', idx + key.length);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < dictText.length - 1; i += 1) {
    if (dictText[i] === '<' && dictText[i + 1] === '<') {
      depth += 1;
      i += 1;
    } else if (dictText[i] === '>' && dictText[i + 1] === '>') {
      depth -= 1;
      i += 1;
      if (depth === 0) {
        return dictText.slice(openIdx, i + 1);
      }
    }
  }
  return dictText.slice(openIdx);
}

function collectOrderedPageObjects(
  objects: Map<number, RawPdfObject>
): Array<{ obj: RawPdfObject; inheritedResources: string }> {
  let rootPagesRef: number | null = null;
  for (const obj of objects.values()) {
    if (/\/Type\s*\/Catalog\b/.test(obj.dictText)) {
      const m = obj.dictText.match(/\/Pages\s+(\d+)\s+\d+\s+R\b/);
      if (m) {
        rootPagesRef = Number(m[1]);
        break;
      }
    }
  }

  const ordered: Array<{ obj: RawPdfObject; inheritedResources: string }> = [];
  const visited = new Set<number>();

  const walkNode = (objNum: number, inheritedResources: string) => {
    if (visited.has(objNum)) return;
    visited.add(objNum);
    const node = objects.get(objNum);
    if (!node) return;

    const ownResources = resolveDictBlock(node.dictText, '/Resources', objects) ?? inheritedResources;
    if (/\/Type\s*\/Pages\b/.test(node.dictText)) {
      const kidsMatch = node.dictText.match(/\/Kids\s*\[([\s\S]*?)\]/);
      if (kidsMatch) {
        for (const ref of kidsMatch[1]!.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
          walkNode(Number(ref[1]), ownResources);
        }
      }
    } else if (/\/Type\s*\/Page\b/.test(node.dictText)) {
      ordered.push({ obj: node, inheritedResources: ownResources });
    }
  };

  if (rootPagesRef !== null) {
    walkNode(rootPagesRef, '');
  }

  if (ordered.length === 0) {
    for (const obj of objects.values()) {
      if (/\/Type\s*\/Page\b/.test(obj.dictText)) {
        ordered.push({
          obj,
          inheritedResources: resolveDictBlock(obj.dictText, '/Resources', objects) ?? ''
        });
      }
    }
  }

  return ordered;
}

export function extractPdfPages(
  pdfBytes: Uint8Array,
  options: { maxExtractBytes?: number; maxPages?: number } = {}
): PdfExtractionResult {
  const maxExtractBytes = options.maxExtractBytes ?? 4_194_304;
  const maxPages = options.maxPages ?? 500;
  const warnings: string[] = [];

  if (pdfBytes.byteLength < 5 || Buffer.from(pdfBytes.subarray(0, 5)).toString('ascii') !== '%PDF-') {
    return {
      pageCount: 0,
      pages: [],
      status: 'FAILED',
      warnings: ['Input bytes do not begin with a %PDF- header.']
    };
  }

  const objects = parsePdfObjects(pdfBytes);
  const pageEntries = collectOrderedPageObjects(objects);
  if (pageEntries.length === 0) {
    return {
      pageCount: 0,
      pages: [],
      status: 'FAILED',
      warnings: ['No readable PDF /Page objects were found.']
    };
  }

  const cmapCache = new Map<number, CMapDecoder>();
  const pages: ExtractedPdfPage[] = [];
  let totalChars = 0;
  let truncated = false;

  const limitPages = Math.min(pageEntries.length, maxPages);
  if (pageEntries.length > maxPages) {
    truncated = true;
    warnings.push(`PDF page count (${pageEntries.length}) exceeded maxPages (${maxPages}); truncated.`);
  }

  for (let idx = 0; idx < limitPages; idx += 1) {
    const { obj: pageObj, inheritedResources } = pageEntries[idx]!;
    const resourcesText = resolveDictBlock(pageObj.dictText, '/Resources', objects) ?? inheritedResources;
    const fontsBlock = resolveDictBlock(resourcesText, '/Font', objects) ?? '';

    const pageFonts = new Map<string, CMapDecoder | undefined>();
    for (const fontRef of fontsBlock.matchAll(/(\/[A-Za-z0-9_.+-]+)\s+(\d+)\s+\d+\s+R\b/g)) {
      const fontName = fontRef[1]!;
      const fontObj = objects.get(Number(fontRef[2]));
      if (!fontObj) continue;
      const toUnicodeRef = fontObj.dictText.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R\b/);
      if (toUnicodeRef) {
        const cmapObjNum = Number(toUnicodeRef[1]);
        let decoder = cmapCache.get(cmapObjNum);
        if (!decoder) {
          const cmapObj = objects.get(cmapObjNum);
          const cmapStream = cmapObj ? decodePdfStream(cmapObj, maxExtractBytes) : null;
          if (cmapStream) {
            decoder = parseToUnicodeCMap(Buffer.from(cmapStream).toString('latin1'));
            cmapCache.set(cmapObjNum, decoder);
          }
        }
        pageFonts.set(fontName, decoder);
      } else {
        pageFonts.set(fontName, undefined);
      }
    }

    const hasImages =
      /\/Subtype\s*\/Image\b/.test(resourcesText) ||
      (() => {
        const xObjBlock = resolveDictBlock(resourcesText, '/XObject', objects) ?? '';
        for (const ref of xObjBlock.matchAll(/\/[A-Za-z0-9_.+-]+\s+(\d+)\s+\d+\s+R\b/g)) {
          const xObj = objects.get(Number(ref[1]));
          if (xObj && /\/Subtype\s*\/Image\b/.test(xObj.dictText)) return true;
        }
        return false;
      })();

    const contentRefs: number[] = [];
    const arrayContents = pageObj.dictText.match(/\/Contents\s*\[([\s\S]*?)\]/);
    if (arrayContents) {
      for (const m of arrayContents[1]!.matchAll(/(\d+)\s+\d+\s+R\b/g)) {
        contentRefs.push(Number(m[1]));
      }
    } else {
      const singleContent = pageObj.dictText.match(/\/Contents\s+(\d+)\s+\d+\s+R\b/);
      if (singleContent) contentRefs.push(Number(singleContent[1]));
    }

    const decodedStreams: string[] = [];
    for (const refNum of contentRefs) {
      const cObj = objects.get(refNum);
      if (!cObj) continue;
      const inflated = decodePdfStream(cObj, maxExtractBytes);
      if (!inflated) {
        warnings.push(`Page ${idx + 1}: unable to decode content stream object ${refNum}.`);
        continue;
      }
      decodedStreams.push(Buffer.from(inflated).toString('latin1'));
    }

    let pageText = renderContentStreamText(decodedStreams.join('\n'), pageFonts);
    if (totalChars + pageText.length > maxExtractBytes) {
      const remaining = Math.max(0, maxExtractBytes - totalChars);
      pageText = pageText.slice(0, remaining);
      truncated = true;
      warnings.push(
        `Extracted text truncated at ${maxExtractBytes} characters on page ${idx + 1} of ${pageEntries.length}.`
      );
    }

    totalChars += pageText.length;
    pages.push({
      pageNumber: idx + 1,
      text: pageText,
      hasImages,
      characterCount: pageText.length
    });

    if (truncated && totalChars >= maxExtractBytes) {
      break;
    }
  }

  if (totalChars === 0) {
    const anyImages = pages.some((p) => p.hasImages);
    return {
      pageCount: pageEntries.length,
      pages,
      status: 'SCANNED_UNSUPPORTED',
      warnings: [
        ...warnings,
        anyImages
          ? 'PDF contains image XObjects with zero extractable text (scanned/image-only PDF requires attributed human-verified extraction).'
          : 'PDF contains zero extractable text characters.'
      ]
    };
  }

  return {
    pageCount: pageEntries.length,
    pages,
    status: truncated ? 'PARTIAL_TRUNCATED' : 'COMPLETE',
    warnings
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function splitBullets(lines: string[]): string[] {
  const bullets: string[] = [];
  for (const raw of lines) {
    const cleaned = raw.replace(/^[•\-*]\s*/, '').trim();
    if (!cleaned) continue;
    if (/^[•\-*]\s*/.test(raw) || bullets.length === 0) {
      bullets.push(cleaned);
    } else {
      bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${cleaned}`;
    }
  }
  return bullets;
}

export function extractPairCriteriaFromPdf(options: {
  pdfBytes: Uint8Array;
  pairId: string;
  capabilityId: string;
  antipatternId: string;
  maxExtractBytes?: number;
}): {
  extraction: PdfExtractionResult;
  criteria: ExtractedPairCriteria | null;
} {
  const extraction = extractPdfPages(options.pdfBytes, {
    maxExtractBytes: options.maxExtractBytes
  });
  if (extraction.status === 'FAILED' || extraction.status === 'SCANNED_UNSUPPORTED') {
    return { extraction, criteria: null };
  }

  const capHeaderPattern = new RegExp(`^${escapeRegExp(options.capabilityId)}\\s+[—–-]\\s+(.+)$`);
  const apHeaderPattern = new RegExp(`^${escapeRegExp(options.antipatternId)}\\s+[—–-]\\s+(.+)$`);

  for (const page of extraction.pages) {
    const lines = page.text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const capIdx = lines.findIndex((l) => capHeaderPattern.test(l));
    const apIdx = lines.findIndex((l) => apHeaderPattern.test(l));
    if (capIdx === -1 || apIdx === -1 || apIdx <= capIdx) continue;

    const capTitle = lines[capIdx]!.match(capHeaderPattern)?.[1]?.trim() ?? options.capabilityId;
    const apTitle = lines[apIdx]!.match(apHeaderPattern)?.[1]?.trim() ?? options.antipatternId;

    const applicabilityIdx = lines.findIndex((l, idx) => idx > capIdx && idx < apIdx && /^Applicability:/i.test(l));
    const primaryQIdx = lines.findIndex((l, idx) => idx > capIdx && idx < apIdx && /^Primary questions$/i.test(l));
    const capIndIdx = lines.findIndex((l, idx) => idx > capIdx && idx < apIdx && /^Capability indicators$/i.test(l));
    const apIndIdx = lines.findIndex((l, idx) => idx > apIdx && /^Anti-pattern indicators$/i.test(l));
    const authoringReqIdx = lines.findIndex(
      (l, idx) => idx > apIdx && /^Authoring requirement:/i.test(l)
    );

    const defEnd = applicabilityIdx !== -1 ? applicabilityIdx : primaryQIdx !== -1 ? primaryQIdx : apIdx;
    const capabilityDefinition = lines.slice(capIdx + 1, defEnd).join(' ').trim();

    let applicability = '';
    if (applicabilityIdx !== -1) {
      const appEnd = primaryQIdx !== -1 ? primaryQIdx : capIndIdx !== -1 ? capIndIdx : apIdx;
      applicability = lines
        .slice(applicabilityIdx, appEnd)
        .join(' ')
        .replace(/^Applicability:\s*/i, '')
        .trim();
    }

    const capabilityIndicators =
      capIndIdx !== -1 ? splitBullets(lines.slice(capIndIdx + 1, apIdx)) : [];

    const apDefEnd = apIndIdx !== -1 ? apIndIdx : authoringReqIdx !== -1 ? authoringReqIdx : lines.length;
    const antipatternDefinition = lines.slice(apIdx + 1, apDefEnd).join(' ').trim();

    const apIndEnd = authoringReqIdx !== -1 ? authoringReqIdx : lines.length;
    const antipatternIndicators =
      apIndIdx !== -1 ? splitBullets(lines.slice(apIndIdx + 1, apIndEnd)) : [];

    return {
      extraction,
      criteria: {
        pair_id: options.pairId,
        page_number: page.pageNumber,
        locator: `PDF page ${page.pageNumber} (${options.capabilityId} / ${options.antipatternId})`,
        capability_id: options.capabilityId,
        capability_title: capTitle,
        capability_definition: capabilityDefinition,
        applicability,
        capability_indicators: capabilityIndicators,
        antipattern_id: options.antipatternId,
        antipattern_title: apTitle,
        antipattern_definition: antipatternDefinition,
        antipattern_indicators: antipatternIndicators
      }
    };
  }

  return { extraction, criteria: null };
}
