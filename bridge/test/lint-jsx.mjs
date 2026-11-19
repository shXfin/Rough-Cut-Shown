// ES3 lint for ExtendScript files: Premiere's engine rejects (or silently misreads) modern JS.
// Usage: node test/lint-jsx.mjs file.jsx ...   Exit code 1 on errors.
import fs from "node:fs";
import vm from "node:vm";

const RULES = [
  [/\blet\s+[A-Za-z_$]/, "let is not ES3 (use var)"],
  [/\bconst\s+[A-Za-z_$]/, "const is not ES3 (use var)"],
  [/=>/, "arrow functions are not ES3"],
  [/`/, "template strings are not ES3"],
  [/\.(map|forEach|filter|reduce|some|every|find|findIndex|includes)\s*\(/, "Array method not in ES3"],
  [/\bJSON\./, "no JSON object in ExtendScript (use __claudeBridge.stringify)"],
  [/\.trim\s*\(\s*\)/, "String.trim is not ES3"],
  [/\bArray\.isArray\b|\bObject\.(keys|assign|create|freeze|entries|values)\b/, "ES5+ built-in"],
  [/\bvar\s+ok\b|\bfunction\s+ok\b|[(,]\s*ok\s*[,)]\s*\{/, "`ok` is reserved in Premiere's eval: rename it"],
  [/,\s*[\]}]/, "trailing comma (ES3 engines choke on it)"],
  [/\bclass\s+[A-Z]/, "class is not ES3"],
  [/\.\.\.[A-Za-z_$]/, "spread is not ES3"],
  [/\bDate\.now\s*\(/, "Date.now is ES5 (use new Date().getTime())"]
];

let errors = 0;
for (const file of process.argv.slice(2)) {
  const src = fs.readFileSync(file, "utf8");
  try {
    new vm.Script(src, { filename: file });
  } catch (e) {
    console.log(`${file}: SYNTAX ${e.message}`);
    errors++;
  }
  const lines = src.split(/\r?\n/);
  let inBlock = false;
  lines.forEach((raw, i) => {
    let line = raw;
    // strip comments and string contents (rough but good enough for our files)
    if (inBlock) {
      const end = line.indexOf("*/");
      if (end < 0) return;
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, "");
    if (line.includes("/*")) {
      line = line.slice(0, line.indexOf("/*"));
      inBlock = true;
    }
    line = line.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");
    line = line.replace(/\/\/.*$/, "");
    for (const [re, msg] of RULES) {
      if (re.test(line)) {
        console.log(`${file}:${i + 1}: ${msg}\n    ${raw.trim()}`);
        errors++;
      }
    }
    // a '/' inside a regex character class must be escaped for ExtendScript
    const rx = raw.match(/[=(,:!&|?]\s*\/((?:[^/\\\n[]|\\.|\[(?:[^\]\\]|\\.)*\])+)\//g) || [];
    for (const r of rx) {
      for (const cls of r.match(/\[(?:[^\]\\]|\\.)*\]/g) || []) {
        if (/(^|[^\\])\//.test(cls.slice(1))) {
          console.log(`${file}:${i + 1}: unescaped / inside a regex [class]: ${cls}`);
          errors++;
        }
      }
    }
  });
}
console.log(errors ? `${errors} problem(s)` : "ES3 lint: clean");
process.exit(errors ? 1 : 0);
