import re
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SVG_PATH = ROOT / 'assets' / 'inventory-icons.svg'
HTML_PATH = ROOT / 'inventory.html'
JS_PATH = ROOT / 'js' / 'inventory.js'

EXPECTED_SYMBOLS = [
    'inventory',
    'stock',
    'purchase',
    'sale',
    'damage',
    'calendar',
    'upload',
    'save',
    'print',
    'share',
    'download',
    'edit',
    'warning',
]


def _local_tag(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def test_inventory_icons_svg_valid_and_safe():
    raw = SVG_PATH.read_text(encoding='utf-8')
    root = ET.fromstring(raw)
    assert root.tag == '{http://www.w3.org/2000/svg}svg'
    assert _local_tag(root.tag) == 'svg'

    symbols = [el for el in root.iter() if _local_tag(el.tag) == 'symbol']
    ids = [el.attrib.get('id') for el in symbols]
    assert len(ids) == len(set(ids)), 'Duplicate symbol IDs found'
    assert set(ids) == set(EXPECTED_SYMBOLS)

    forbidden_tags = {'script', 'image', 'foreignobject', 'style', 'iframe', 'object', 'embed', 'font', 'text'}
    for el in root.iter():
        tag = _local_tag(el.tag).lower()
        assert tag not in forbidden_tags, f'Forbidden element <{tag}> in icon sprite'
        for attr, val in el.attrib.items():
            attr_name = _local_tag(attr).lower()
            assert not attr_name.startswith('on'), f'Forbidden event handler {attr_name}'
            assert attr_name not in {'href', 'src'}, f'Unexpected external attribute {attr_name}'
            assert 'url(' not in val.lower()
            assert 'font-family' not in val.lower()

    lowered = raw.lower()
    urls = re.findall(r'https?://[^\s"\'<>]+', lowered)
    assert urls == ['http://www.w3.org/2000/svg'], f'Unexpected external URLs in SVG: {urls}'
    for token in ('javascript:', 'data:', '@import', '<script', 'xlink:href'):
        assert token not in lowered, f'Forbidden token {token!r} found in SVG'

    for sym in symbols:
        assert sym.attrib.get('viewBox') == '0 0 24 24'
        assert sym.attrib.get('stroke') == 'currentColor'
        assert sym.attrib.get('fill') == 'none'
        assert len(list(sym)) >= 1, f'Symbol {sym.attrib.get("id")} must contain drawable primitives'


def test_inventory_page_uses_valid_accessible_icons():
    html = HTML_PATH.read_text(encoding='utf-8')
    js = JS_PATH.read_text(encoding='utf-8')

    html_refs = re.findall(r'assets/inventory-icons\.svg#([a-z0-9-]+)', html)
    js_refs = re.findall(r"svgIcon\(\s*'([a-z0-9-]+)'", js)
    used = set(html_refs) | set(js_refs)

    assert used, 'Expected inventory UI to reference icon symbols'
    assert used.issubset(set(EXPECTED_SYMBOLS)), f'Unknown icon refs: {used - set(EXPECTED_SYMBOLS)}'
    # Every symbol in the sprite is actively used by the inventory UI.
    assert used == set(EXPECTED_SYMBOLS)

    # All static <svg> embeds in inventory.html are decorative and keep visible text labels nearby.
    for match in re.finditer(r'<svg\b([^>]*)>', html):
        attrs = match.group(1)
        assert 'aria-hidden="true"' in attrs
