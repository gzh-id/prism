// 把 .cmd 的行尾统一成 CRLF，并做一次自检。
// cmd.exe 对 LF-only 的批处理文件解析不可靠（括号块、标签会出错）。
// 用法：node scripts/fix-cmd-eol.mjs <文件> [文件...]
import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('用法：node scripts/fix-cmd-eol.mjs <文件> [文件...]');
  process.exit(1);
}

for (const file of files) {
  let text = readFileSync(file, 'utf8');

  // 先归一成 LF，再整体换成 CRLF，避免出现 \r\r\n
  text = text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');

  writeFileSync(file, text, 'latin1');

  const buf = readFileSync(file);
  const raw = buf.toString('latin1');
  const crlf = (raw.match(/\r\n/g) ?? []).length;
  const loneLf = (raw.match(/(?<!\r)\n/g) ?? []).length;
  const bom = [...buf.slice(0, 3)].map((x) => x.toString(16).padStart(2, '0')).join(' ');
  const nonAscii = /[\x80-\xFF]/.test(raw);

  console.log(`文件      ${file}`);
  console.log(`BOM       ${bom === 'ef bb bf' ? '有（需去掉）' : '无'}`);
  console.log(`非 ASCII  ${nonAscii ? '有（需改成英文）' : '无'}`);
  console.log(`CRLF 行数 ${crlf}`);
  console.log(`孤立 LF   ${loneLf}${loneLf === 0 ? '（正确）' : '（存在，需修复）'}`);
  console.log('');
}
