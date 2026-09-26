(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.CEC = root.CEC || {};
    root.CEC.xlsx = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function toCSV(rows) {
    if (!rows || !rows.length) return "";
    const escape = cell => {
      const s = cell === null || cell === undefined ? "" : String(cell);
      return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(escape).join(",")).join("\n") + "\n";
  }

  function crc32(bytes) {
    const table = crc32.table || (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
      }
      return t;
    })());
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    return {
      time: ((date.getHours() & 0x1f) << 11) | ((date.getMinutes() & 0x3f) << 5) | ((date.getSeconds() & 0x3e) >> 1),
      date: (((date.getFullYear() - 1980) & 0x7f) << 9) | (((date.getMonth() + 1) & 0x0f) << 5) | (date.getDate() & 0x1f)
    };
  }

  function buildZip(entries) {
    const now = dosDateTime(new Date());
    const local = [];
    const central = [];
    let offset = 0;
    const enc = new TextEncoder();
    entries.forEach(entry => {
      const nameBytes = enc.encode(entry.name);
      const dataBytes = entry.bytes;
      const crc = crc32(dataBytes);
      const len = dataBytes.length;
      local.push([0x50, 0x4b, 0x03, 0x04, 20, 0, 0, 0, 0, 0,
        now.time & 0xff, now.time >>> 8, now.date & 0xff, now.date >>> 8,
        crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        nameBytes.length & 0xff, nameBytes.length >>> 8, 0, 0],
        Array.from(nameBytes), Array.from(dataBytes));
      central.push([0x50, 0x4b, 0x01, 0x02, 0x14, 0x00, 20, 0, 0, 0, 0, 0,
        now.time & 0xff, now.time >>> 8, now.date & 0xff, now.date >>> 8,
        crc & 0xff, (crc >>> 8) & 0xff, (crc >>> 16) & 0xff, (crc >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        len & 0xff, (len >>> 8) & 0xff, (len >>> 16) & 0xff, (len >>> 24) & 0xff,
        nameBytes.length & 0xff, nameBytes.length >>> 8, 0, 0, 0, 0, 0, 0, 0, 0,
        offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff],
        Array.from(nameBytes));
      offset += 30 + nameBytes.length + dataBytes.length;
    });
    const centralSize = central.reduce((n, arr) => n + arr.length, 0);
    const end = [0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0,
      entries.length & 0xff, entries.length >>> 8, entries.length & 0xff, entries.length >>> 8,
      centralSize & 0xff, (centralSize >>> 8) & 0xff, (centralSize >>> 16) & 0xff, (centralSize >>> 24) & 0xff,
      offset & 0xff, (offset >>> 8) & 0xff, (offset >>> 16) & 0xff, (offset >>> 24) & 0xff,
      0, 0];
    const all = local.concat(central, [end]);
    const total = all.reduce((n, arr) => n + arr.length, 0);
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach(arr => { out.set(arr, p); p += arr.length; });
    return out;
  }

  function xmlEscape(s) {
    return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }

  function colName(i) {
    let n = i + 1;
    let s = "";
    while (n > 0) {
      n -= 1;
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26);
    }
    return s;
  }

  function buildSheetXml(rows) {
    const cellXml = (ref, cell) => {
      if (typeof cell === "number" && isFinite(cell)) {
        return '<c r="' + ref + '"><v>' + cell + "</v></c>";
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t>' + xmlEscape(cell === null || cell === undefined ? "" : cell) + "</t></is></c>";
    };
    const lines = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
    rows.forEach((row, i) => {
      lines.push('<row r="' + (i + 1) + '">');
      row.forEach((cell, j) => lines.push(cellXml(colName(j) + (i + 1), cell)));
      lines.push("</row>");
    });
    lines.push("</sheetData></worksheet>");
    return lines.join("");
  }

  function toXLSX(rows) {
    const data = (rows || []).map(r => r.map(c => (c === null || c === undefined ? "" : c)));
    const enc = new TextEncoder();
    const sheetXml = buildSheetXml(data);
    return buildZip([
      { name: "[Content_Types].xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        "</Types>") },
      { name: "_rels/.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>") },
      { name: "xl/workbook.xml", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Export" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        "</Relationships>") },
      { name: "xl/worksheets/sheet1.xml", bytes: enc.encode(sheetXml) }
    ]);
  }

  return { toCSV, toXLSX };
});