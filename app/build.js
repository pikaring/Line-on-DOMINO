/*
 * build.js - index.html に CSS / JS を埋め込んで 1 ファイルにまとめる
 *
 *   node build.js                     -> standalone.html （単体で配布できる HTML）
 *   node build.js --fragment out.html -> <body> の中身だけ（埋め込み用）
 *
 * 元の index.html は分割したまま編集し、配布用のファイルはここから生成する。
 */
var fs = require('fs');
var path = require('path');

var root = __dirname;
var html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// CSS を <style> に置き換える
html = html.replace(/[ \t]*<link rel="stylesheet" href="([^"]+)">\n?/g, function (_, href) {
  return '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8').trim() + '\n</style>\n';
});

// 外部スクリプトを埋め込む
html = html.replace(/[ \t]*<script src="([^"]+)"><\/script>\n?/g, function (_, src) {
  var code = fs.readFileSync(path.join(root, src), 'utf8').trim();
  if (code.indexOf('</script') >= 0) throw new Error('script tag in ' + src);
  return '<script>\n' + code + '\n</script>\n';
});

var fragIndex = process.argv.indexOf('--fragment');
if (fragIndex >= 0) {
  var out = process.argv[fragIndex + 1];
  if (!out) { console.error('usage: node build.js --fragment <path>'); process.exit(1); }
  // <title> と <style> は残しつつ、<head>/<body> のタグ自体は取り除く
  var title = (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0];
  var styles = (html.match(/<style>[\s\S]*?<\/style>/g) || []).join('\n');
  var body = html.slice(html.indexOf('<body>') + '<body>'.length, html.lastIndexOf('</body>')).trim();
  fs.writeFileSync(out, [title, styles, body, ''].join('\n'));
  console.log('wrote ' + out + ' (' + Math.round(fs.statSync(out).size / 1024) + ' KB)');
} else {
  var dest = path.join(root, 'standalone.html');
  fs.writeFileSync(dest, html);
  console.log('wrote ' + dest + ' (' + Math.round(fs.statSync(dest).size / 1024) + ' KB)');
}
