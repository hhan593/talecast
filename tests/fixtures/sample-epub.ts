/** 测试 fixture：用 JSZip 在测试内构造最小合法 EPUB（无二进制资源） */
import JSZip from 'jszip';

export async function buildSampleEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'content.opf',
    `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>山河故人</dc:title></metadata>
  <manifest>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`,
  );
  zip.file(
    'text/ch1.xhtml',
    '<html><body><h1>第一章 重逢</h1><p>清晨的雾还没有散去。</p><p>两人隔着桥栏对望。</p></body></html>',
  );
  zip.file(
    'text/ch2.xhtml',
    '<html><body><h1>第二章 别离</h1><p>那天的雨下了整夜。</p></body></html>',
  );
  return zip.generateAsync({ type: 'uint8array' });
}
