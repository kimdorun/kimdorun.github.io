/* ==========================================================================
   HWPX 규격 점검기 — 100% 브라우저 로컬 처리 엔진 (외부 라이브러리 0개)
   · ZIP: EOCD → 중앙 디렉터리 → 로컬 헤더를 직접 읽고
           DecompressionStream('deflate-raw') 또는 Store(무압축) 방식으로 해제
   · XML: 브라우저 기본 DOMParser (없으면 정규식 폴백)
   · 네트워크 요청 없음 — 파일은 서버로 전송되지 않습니다
   ========================================================================== */
(function (root) {
  'use strict';

  var SIG_EOCD = 0x06054b50;
  var SIG_CD = 0x02014b50;
  var SIG_LOCAL = 0x04034b50;

  var PLACEHOLDERS = [
    { token: 'OOO', label: '자리표시자 OOO' },
    { token: '○○○', label: '자리표시자 ○○○' },
    { token: 'ㅇㅇㅇ', label: '자리표시자 ㅇㅇㅇ' },
    { token: '홍길동', label: '예시 이름(홍길동)' },
    { token: '[작성]', label: '[작성] 표시' },
    { token: '작성 예시', label: '작성 예시 문구' },
    { token: '여기에 입력', label: '입력 안내 문구' },
    { token: '내용을 입력', label: '입력 안내 문구' },
    { token: 'XXX', label: '자리표시자 XXX' },
    { token: '미정', label: '미정 표시' },
    { token: '000-0000', label: '자리표시자 전화번호' },
    { token: '2025. 00. 00', label: '자리표시자 날짜' }
  ];

  function decodeUtf8(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (e) {
      var out = '';
      for (var i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
      return out;
    }
  }

  function findEocd(dv, length) {
    var limit = Math.max(0, length - 65557);
    for (var i = length - 22; i >= limit; i--) {
      if (dv.getUint32(i, true) === SIG_EOCD) return i;
    }
    return -1;
  }

  /* 중앙 디렉터리 파싱 — 실패하면 사용자가 이해할 수 있는 한국어 오류를 던진다 */
  function parseZip(buffer) {
    var dv = new DataView(buffer);
    var bytes = new Uint8Array(buffer);
    if (bytes.length < 22) throw new Error('파일이 너무 작습니다. .hwpx 파일이 맞는지 확인하세요.');

    var eocd = findEocd(dv, bytes.length);
    if (eocd < 0) throw new Error('ZIP 중앙 디렉터리(EOCD)를 찾지 못했습니다. 한글(.hwp)·PDF 파일이거나 손상된 압축 파일입니다.');

    var count = dv.getUint16(eocd + 10, true);
    var cdSize = dv.getUint32(eocd + 12, true);
    var cdOffset = dv.getUint32(eocd + 16, true);
    if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
      throw new Error('ZIP64 형식은 지원하지 않습니다. 한글에서 .hwpx로 다시 저장해 주세요.');
    }
    if (cdOffset + cdSize > bytes.length + 1) {
      throw new Error('중앙 디렉터리 위치가 파일 범위를 벗어났습니다. 파일이 잘렸거나 손상되었습니다.');
    }

    var entries = [];
    var p = cdOffset;
    for (var i = 0; i < count; i++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== SIG_CD) {
        throw new Error('중앙 디렉터리 ' + (i + 1) + '번째 항목이 손상되었습니다.');
      }
      var nameLen = dv.getUint16(p + 28, true);
      var extraLen = dv.getUint16(p + 30, true);
      var commentLen = dv.getUint16(p + 32, true);
      entries.push({
        name: decodeUtf8(bytes.subarray(p + 46, p + 46 + nameLen)),
        method: dv.getUint16(p + 10, true),
        crc: dv.getUint32(p + 16, true),
        compressedSize: dv.getUint32(p + 20, true),
        size: dv.getUint32(p + 24, true),
        localOffset: dv.getUint32(p + 42, true)
      });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { bytes: bytes, dv: dv, entries: entries, count: count };
  }

  function entryByName(zip, name) {
    for (var i = 0; i < zip.entries.length; i++) {
      if (zip.entries[i].name === name) return zip.entries[i];
    }
    return null;
  }

  /* 로컬 헤더 → 압축 데이터 → 해제 */
  function readEntry(zip, entry) {
    var dv = zip.dv;
    var p = entry.localOffset;
    if (p + 30 > zip.bytes.length || dv.getUint32(p, true) !== SIG_LOCAL) {
      throw new Error('"' + entry.name + '" 로컬 헤더가 손상되었습니다.');
    }
    var nameLen = dv.getUint16(p + 26, true);
    var extraLen = dv.getUint16(p + 28, true);
    var start = p + 30 + nameLen + extraLen;
    var end = start + entry.compressedSize;
    if (end > zip.bytes.length) throw new Error('"' + entry.name + '" 데이터가 파일 범위를 벗어났습니다.');
    var raw = zip.bytes.subarray(start, end);

    if (entry.method === 0) return Promise.resolve(raw);
    if (entry.method !== 8) {
      return Promise.reject(new Error('"' + entry.name + '" 이 지원하지 않는 압축 방식(' + entry.method + ')입니다.'));
    }
    if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined' || typeof Response === 'undefined') {
      return Promise.reject(new Error('이 브라우저는 압축 해제(DecompressionStream)를 지원하지 않습니다. 최신 Chrome·Edge·Safari에서 이용해 주세요.'));
    }
    var stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Response(stream).arrayBuffer().then(function (buf) {
      return new Uint8Array(buf);
    });
  }

  /* ---------- XML 분석 (DOMParser 우선, 정규식 폴백) ---------- */
  function analyzeSectionXml(xmlText) {
    var result = { paragraphs: 0, tables: 0, text: '', mode: 'dom' };
    var doc = null;
    if (typeof DOMParser !== 'undefined') {
      try {
        doc = new DOMParser().parseFromString(xmlText, 'application/xml');
        if (doc && doc.getElementsByTagName('parsererror').length > 0) doc = null;
      } catch (e) {
        doc = null;
      }
    }

    if (doc) {
      var all = doc.getElementsByTagName('*');
      var texts = [];
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var ln = el.localName || el.nodeName;
        if (ln === 'p') result.paragraphs++;
        else if (ln === 'tbl') result.tables++;
        else if (ln === 't' && (el.textContent || '').length) texts.push(el.textContent);
      }
      result.text = texts.join('');
      return result;
    }

    // 폴백: XML 파서를 쓸 수 없는 환경(아주 오래된 브라우저)
    result.mode = 'regex';
    result.paragraphs = (xmlText.match(/<hp:p[\s>]/g) || []).length;
    result.tables = (xmlText.match(/<hp:tbl[\s>]/g) || []).length;
    var re = /<hp:t(?:\s[^>]*)?>([\s\S]*?)<\/hp:t>/g;
    var m;
    var buf = [];
    while ((m = re.exec(xmlText)) !== null) {
      buf.push(m[1]
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
    }
    result.text = buf.join('');
    return result;
  }

  function countChars(text) {
    var chars = Array.from ? Array.from(text) : text.split('');
    var total = 0;
    var noSpace = 0;
    for (var i = 0; i < chars.length; i++) {
      total++;
      if (!/\s/.test(chars[i])) noSpace++;
    }
    return { withSpace: total, withoutSpace: noSpace };
  }

  function findPlaceholders(text) {
    var found = [];
    for (var i = 0; i < PLACEHOLDERS.length; i++) {
      var p = PLACEHOLDERS[i];
      var idx = text.indexOf(p.token);
      if (idx < 0) continue;
      var hits = 0;
      var from = 0;
      while (true) {
        var at = text.indexOf(p.token, from);
        if (at < 0) break;
        hits++;
        from = at + p.token.length;
        if (hits > 50) break;
      }
      var ctxStart = Math.max(0, idx - 14);
      found.push({
        token: p.token,
        label: p.label,
        count: hits,
        context: text.slice(ctxStart, idx + p.token.length + 14).replace(/\s+/g, ' ')
      });
    }
    return found;
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }

  function versionInfo(xmlText) {
    var info = { raw: xmlText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160), version: '' };
    var major = /major="([^"]*)"/.exec(xmlText);
    var minor = /minor="([^"]*)"/.exec(xmlText);
    var micro = /micro="([^"]*)"/.exec(xmlText);
    var app = /application="([^"]*)"/.exec(xmlText);
    var tag = /tagetApplication="([^"]*)"/.exec(xmlText);
    if (major) {
      info.version = [major[1], minor ? minor[1] : '0', micro ? micro[1] : '0'].join('.');
    }
    if (app) info.application = app[1];
    if (tag) info.target = tag[1];
    return info;
  }

  function sectionFiles(entries) {
    var list = [];
    for (var i = 0; i < entries.length; i++) {
      var m = /^Contents\/section(\d+)\.xml$/.exec(entries[i].name);
      if (m) list.push({ index: parseInt(m[1], 10), entry: entries[i] });
    }
    list.sort(function (a, b) { return a.index - b.index; });
    return list;
  }

  /* ---------- 전체 분석 ---------- */
  function analyze(buffer, settings) {
    settings = settings || {};
    var zip = parseZip(buffer);
    var entries = zip.entries;
    var names = entries.map(function (e) { return e.name; });

    var mimetypeEntry = entryByName(zip, 'mimetype');
    var sectionList = sectionFiles(entries);
    var binEntries = entries.filter(function (e) { return e.name.indexOf('BinData/') === 0; });
    var binBytes = binEntries.reduce(function (sum, e) { return sum + e.size; }, 0);

    var steps = [];

    var mimetypePromise = mimetypeEntry
      ? readEntry(zip, mimetypeEntry).then(function (bytes) { return decodeUtf8(bytes).trim(); })
      : Promise.resolve(null);

    return mimetypePromise.then(function (mimetype) {
      steps.push({ name: 'mimetype', ok: mimetype === 'application/hwp+zip', value: mimetype || '(없음)' });

      var versionPromise = entryByName(zip, 'version.xml')
        ? readEntry(zip, entryByName(zip, 'version.xml')).then(function (b) { return versionInfo(decodeUtf8(b)); })
        : Promise.resolve(null);

      return versionPromise.then(function (version) {
        if (version) steps.push({ name: 'version.xml', ok: !!version.version, value: version.version || '(버전 미기재)' });

        // 섹션들을 순서대로 해제·분석
        var chain = Promise.resolve();
        var sections = [];
        sectionList.forEach(function (item) {
          chain = chain.then(function () {
            return readEntry(zip, item.entry).then(function (bytes) {
              var xml = decodeUtf8(bytes);
              var parsed = analyzeSectionXml(xml);
              var chars = countChars(parsed.text);
              sections.push({
                index: item.index,
                name: item.entry.name,
                bytes: item.entry.size,
                paragraphs: parsed.paragraphs,
                tables: parsed.tables,
                chars: chars,
                text: parsed.text,
                parseMode: parsed.mode
              });
            });
          });
        });

        return chain.then(function () {
          var text = sections.map(function (s) { return s.text; }).join('\n');
          var chars = countChars(text);
          var paragraphs = sections.reduce(function (sum, s) { return sum + s.paragraphs; }, 0);
          var tables = sections.reduce(function (sum, s) { return sum + s.tables; }, 0);
          var placeholders = findPlaceholders(text);
          var limit = Number(settings.charLimit) || 0;
          var limitBasis = settings.limitBasis === 'withSpace' ? chars.withSpace : chars.withoutSpace;

          var warnings = [];
          var errors = [];
          if (mimetype === null) {
            warnings.push('mimetype 항목이 없습니다. 한글에서 .hwpx로 다시 저장하면 표준 규격(application/hwp+zip)이 들어갑니다.');
          } else if (mimetype !== 'application/hwp+zip') {
            warnings.push('mimetype 값이 "' + mimetype + '"입니다. 표준 .hwpx는 application/hwp+zip 이어야 합니다.');
          }
          if (!version || !version.version) warnings.push('version.xml에서 한글 문서 버전을 확인하지 못했습니다.');
          if (!sectionList.length) errors.push('Contents/section*.xml 본문을 찾지 못했습니다. .hwpx 파일이 맞는지 확인하세요.');
          if (placeholders.length) warnings.push('미완료 자리표시자로 보이는 표현이 ' + placeholders.length + '종 있습니다. 제출 전에 실제 내용으로 바꿨는지 확인하세요.');
          if (limit > 0 && limitBasis > limit) warnings.push('글자 수 제한(' + limit.toLocaleString('ko-KR') + '자)을 ' + (limitBasis - limit).toLocaleString('ko-KR') + '자 초과했습니다.');

          return {
            fileName: settings.fileName || '(파일명 없음)',
            fileSize: buffer.byteLength,
            fileSizeText: formatBytes(buffer.byteLength),
            entryCount: entries.length,
            entries: names,
            mimetype: mimetype,
            version: version,
            sectionCount: sections.length,
            sections: sections,
            chars: chars,
            paragraphs: paragraphs,
            tables: tables,
            binCount: binEntries.length,
            binBytes: binBytes,
            binBytesText: formatBytes(binBytes),
            binNames: binEntries.map(function (e) { return e.name; }),
            placeholders: placeholders,
            charLimit: limit,
            limitBasis: limitBasis,
            warnings: warnings,
            errors: errors,
            steps: steps,
            // 공모전 서식 점검에서 자주 보는 항목
            hasPreview: names.indexOf('Preview/PrvText.txt') >= 0,
            hasContentHpf: names.indexOf('Contents/content.hpf') >= 0,
            hasHeader: names.indexOf('Contents/header.xml') >= 0
          };
        });
      });
    });
  }

  var api = {
    analyze: analyze,
    parseZip: parseZip,
    readEntry: readEntry,
    analyzeSectionXml: analyzeSectionXml,
    countChars: countChars,
    findPlaceholders: findPlaceholders,
    versionInfo: versionInfo,
    formatBytes: formatBytes,
    PLACEHOLDERS: PLACEHOLDERS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.HwpxCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
