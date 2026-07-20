/**
 * CIRoS 業績自動更新システム — HP描画層
 * 外部設計書 v1.3 §7 / CONTRACT.md §7（2026-07-10改訂）準拠。
 *
 * 出力マークアップは既存HP（CIRoS-Soka.github.io / styles.css）に一致させる:
 *   publications: ul.plist > li > article.pi > div > cite.pt + div.pa
 *   fundings:     ul.ggrid > li > article.gi > div.gn + div.gm + div.ga
 *   awards:       ul.alist > li > article.ai > time.ay + span.at
 *
 * 言語切替は既存HPの lc 属性方式（styles.css: [lc="en"]{display:none} /
 * body.en [lc="ja"]{display:none} / body.en [lc="en"]{display:block}）に従い、
 * ja/en 両方あるフィールドは lc="ja"/lc="en" の2要素を出力、
 * 片方しか無ければ lc 属性なしの1要素（常時表示）を出力する。
 *
 * GyosekiRenderer.init({url, targets, lang})
 *   ブラウザ専用処理（fetch/DOM操作）はこの関数内に隔離。
 *   fetch失敗時は console.warn のみで既存表示を維持（UC-6例外・NFR-04）。
 *   targets のセレクタ先に既存の ul.plist/ggrid/alist があればその ul だけを
 *   差し替える（セクション見出しを消さないため。targetsにセクションidを渡せる）。
 */
var GyosekiRenderer = (function () {
  'use strict';

  var SECTIONS = ['publications', 'fundings', 'awards'];
  var UL_CLASS = { publications: 'plist', fundings: 'ggrid', awards: 'alist' };
  var EMPTY_HTML = '<p class="gyoseki-empty">(準備中 / Coming soon)</p>';
  var MAJOR_STAR = '<span class="gyoseki-major-star" aria-hidden="true">★</span> ';
  // ★の意味を示す凡例。★付きが1件以上あるときだけ publications セクションに添える
  var MAJOR_LEGEND =
    '<p class="gyoseki-legend">' +
    '<span class="gyoseki-major-star" aria-hidden="true">★</span>' +
    '<span lc="ja">主要業績</span><span lc="en">Selected key publication</span>' +
    '</p>';

  /**
   * センター員（著者名に下線を引く対象）。
   * GASのmembersシートと同じ5名。メンバーを増減したらここも更新すること
   * （membersシートはname_enが未入力のため、英字表記はここで保持している）。
   * family/given はローマ字、ja は日本語表記（姓名の間の空白有無は問わずマッチする）。
   */
  var CENTER_MEMBERS = [
    { ja: '崔龍雲',     family: 'Choi',     given: 'Yongwoon' },
    { ja: '伊与田健敏', family: 'Iyota',    given: 'Taketoshi' },
    { ja: '萩原良信',   family: 'Hagiwara', given: 'Yoshinobu' },
    { ja: '宍戸英彦',   family: 'Shishido', given: 'Hidehiko' },
    { ja: '鈴木彰真',   family: 'Suzuki',   given: 'Akimasa' }
  ];

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // 1名分のマッチパターン。姓のみの一致は同姓の別人を巻き込むため採用しない
  function memberPattern(m) {
    var fam = escapeRegExp(m.family);
    var giv = escapeRegExp(m.given);
    var ini = escapeRegExp(m.given.charAt(0));
    var jaChars = m.ja.split('').map(escapeRegExp).join('\\s*'); // 「鈴木 彰真」「鈴木彰真」の両方
    return [
      jaChars,
      giv + '\\s+' + fam,          // Yoshinobu Hagiwara
      fam + ',\\s*' + ini + '\\.', // Hagiwara, Y.
      ini + '\\.\\s*' + fam        // Y. Hagiwara
    ].join('|');
  }

  var MEMBER_RE = new RegExp('(' + CENTER_MEMBERS.map(memberPattern).join('|') + ')', 'g');

  /**
   * underlineMembers(escapedAuthors): エスケープ済みの著者文字列中のセンター員名を下線付きに包む。
   * 必ず esc() の後に適用する（生文字列に適用するとタグが壊れる）。
   */
  function underlineMembers(escapedAuthors) {
    if (!escapedAuthors) return escapedAuthors;
    return escapedAuthors.replace(MEMBER_RE, '<span class="gyoseki-member">$1</span>');
  }

  // --- XSS対策: &<>"' を実体参照へ（§7 XSSエスケープ必須） ---
  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toStr(v) {
    return v === null || v === undefined ? '' : String(v);
  }

  // {ja?,en?} → 指定langを優先し、空なら他言語へフォールバック（§7 lang表示規則）
  function pickLang(field, lang) {
    if (!field || typeof field !== 'object') return '';
    var other = lang === 'en' ? 'ja' : 'en';
    var primary = field[lang];
    if (primary !== null && primary !== undefined && String(primary).trim() !== '') {
      return String(primary);
    }
    var fallback = field[other];
    if (fallback !== null && fallback !== undefined && String(fallback).trim() !== '') {
      return String(fallback);
    }
    return '';
  }

  /**
   * 二言語出力の共通化（CONTRACT §7）。
   * renderFn('ja')/renderFn('en') はエスケープ済みinner HTML（無ければ ''）を返す。
   * 両言語とも中身があり異なる → lc="ja"/lc="en" の2要素。
   * 片方のみ（または同一） → lc なしの1要素（prefLang優先で選択）。
   */
  function bilingual(tag, cls, renderFn, prefLang) {
    var ja = renderFn('ja');
    var en = renderFn('en');

    function wrap(lc, inner) {
      return '<' + tag + ' class="' + cls + '"' + (lc ? ' lc="' + lc + '"' : '') + '>' +
        inner + '</' + tag + '>';
    }

    if (ja && en && ja !== en) {
      return wrap('ja', ja) + wrap('en', en);
    }
    var single = prefLang === 'en' ? (en || ja) : (ja || en);
    return single ? wrap(null, single) : '';
  }

  // --- publications: 「著者 — 誌名, Vol.X, No.Y, 年」(.pa) ---
  function renderPublication(item, lang) {
    item = item || {};
    var isMajor = item.major === true;
    var volume = toStr(item.volume);
    var number = toStr(item.number);
    var year = item.year !== null && item.year !== undefined ? toStr(item.year) : '';

    var titleHtml = bilingual('cite', 'pt', function (lc) {
      var t = item.title && item.title[lc] ? String(item.title[lc]).trim() : '';
      if (!t) return '';
      return (isMajor ? MAJOR_STAR : '') + esc(t);
    }, lang);

    var linkHtml = '';
    var doi = toStr(item.doi);
    var url = toStr(item.url);
    if (doi || url) {
      var href = url || ('https://doi.org/' + doi);
      linkHtml = ' <a class="gyoseki-link" href="' + esc(href) +
        '" target="_blank" rel="noopener noreferrer">' + (doi ? 'DOI' : 'Link') + '</a>';
    }

    var paHtml = bilingual('div', 'pa', function (lc) {
      // 著者・誌名は片言語欠落時に他言語へフォールバック（§7 lang表示規則）。
      // 両言語で同一内容になれば bilingual が lc なしの1要素に畳む。
      var authors = pickLang(item.authors, lc).trim();
      var journal = pickLang(item.journal, lc).trim();
      var bits = [];
      if (journal) bits.push(esc(journal));
      if (volume) bits.push('Vol.' + esc(volume));
      if (number) bits.push('No.' + esc(number));
      if (year) bits.push(esc(year));
      var rest = bits.join(', ');
      if (!authors && !rest) return '';
      var inner = underlineMembers(esc(authors)) + (authors && rest ? ' — ' : '') + rest;
      return inner + linkHtml;
    }, lang);

    var cls = 'pi gyoseki-item gyoseki-publication' + (isMajor ? ' gyoseki-major' : '');
    return '<li><article class="' + cls + '"><div>' + titleHtml + paHtml + '</div></article></li>';
  }

  // --- fundings: 課題名(.gn)／「提供機関 制度 ／ 研究代表者（役割）」(.gm)／badgeまたは(年)(.ga) ---
  function renderFunding(item, lang) {
    item = item || {};
    var role = toStr(item.role); // '代表' | '分担' | ''
    var year = item.year !== null && item.year !== undefined ? toStr(item.year) : '';

    var gnHtml = bilingual('div', 'gn', function (lc) {
      var t = item.title && item.title[lc] ? String(item.title[lc]).trim() : '';
      return t ? esc(t) : '';
    }, lang);

    var gmHtml = bilingual('div', 'gm', function (lc) {
      // 提供機関・制度・研究代表者は片言語欠落時に他言語へフォールバック（§7 lang表示規則）
      var funder = pickLang(item.funder, lc).trim();
      var system = pickLang(item.system, lc).trim();
      var pi = pickLang(item.principal_investigator, lc).trim();
      var left = [funder, system].filter(Boolean).map(esc).join(' ');
      var right = '';
      if (pi) {
        if (lc === 'ja') {
          right = esc(pi) + (role ? '（' + esc(role) + '）' : '');
        } else {
          var roleEn = role === '代表' ? ' (PI)' : role === '分担' ? ' (Co-I)' : '';
          right = esc(pi) + roleEn;
        }
      }
      if (!left && !right) return '';
      var sep = lc === 'ja' ? ' ／ ' : ' / ';
      return left + (left && right ? sep : '') + right;
    }, lang);

    // .ga は既存HPでも単一表記（lcなし）。badge優先、無ければ (年)
    var badge = toStr(item.badge).trim();
    var gaText = badge || (year ? '(' + year + ')' : '');
    var gaHtml = gaText ? '<div class="ga">' + esc(gaText) + '</div>' : '';

    return '<li><article class="gi gyoseki-item gyoseki-funding">' + gnHtml + gmHtml + gaHtml + '</article></li>';
  }

  // --- awards: 年(.ay)＋「賞名 ／ 対象業績（受賞者）」(.at。enは「— 対象 (受賞者)」) ---
  function renderAward(item, lang) {
    item = item || {};
    var year = item.year !== null && item.year !== undefined ? toStr(item.year) : '';
    var ayHtml = year
      ? '<time class="ay" datetime="' + esc(year) + '">' + esc(year) + '</time>'
      : '';

    var atHtml = bilingual('span', 'at', function (lc) {
      var t = item.title && item.title[lc] ? String(item.title[lc]).trim() : '';
      var target = item.target && item.target[lc] ? String(item.target[lc]).trim() : '';
      var recipients = item.recipients && item.recipients[lc] ? String(item.recipients[lc]).trim() : '';
      if (!t && !target) return '';
      var inner = esc(t);
      if (target) inner += (t ? (lc === 'ja' ? ' ／ ' : ' — ') : '') + esc(target);
      if (recipients) inner += lc === 'ja' ? '（' + esc(recipients) + '）' : ' (' + esc(recipients) + ')';
      return inner;
    }, lang);

    return '<li><article class="ai gyoseki-item gyoseki-award">' + ayHtml + atHtml + '</article></li>';
  }

  var RENDERERS = {
    publications: renderPublication,
    fundings: renderFunding,
    awards: renderAward
  };

  /**
   * data: data.json 全体（{meta, publications, fundings, awards}）
   * section: 'publications' | 'fundings' | 'awards'
   * lang: 'ja' | 'en'（既定 'ja'。片方言語しか無いフィールドの選択にのみ使用。
   *       両言語あるフィールドは lc属性付きで両方出力され、表示側のCSSで切り替わる）
   * maxItems: 先頭からの表示上限件数（省略・0以下なら無制限。データは書き出し時に
   *       display_order→年降順で整列済みのため、先頭N件＝最新N件になる）
   * 戻り値: HTML文字列（DOM APIを一切使わない純粋関数）
   */
  function buildSectionHTML(data, section, lang, maxItems) {
    var effLang = lang === 'en' ? 'en' : 'ja';
    var renderItem = RENDERERS[section];
    var items = data && Array.isArray(data[section]) ? data[section] : [];
    if (typeof maxItems === 'number' && maxItems > 0 && items.length > maxItems) {
      items = items.slice(0, maxItems);
    }

    if (!renderItem || items.length === 0) {
      return EMPTY_HTML;
    }

    var rows = items.map(function (item) {
      return renderItem(item, effLang);
    });

    var listHtml = '<ul class="' + UL_CLASS[section] + ' gyoseki-list gyoseki-' + section + '">\n' +
      rows.join('\n') + '\n</ul>';

    // 表示された論文に★付きが含まれるときだけ凡例を出す（★が無いのに凡例だけ残るのを防ぐ）
    if (section === 'publications' && items.some(function (it) { return it && it.major === true; })) {
      return listHtml + '\n' + MAJOR_LEGEND;
    }
    return listHtml;
  }

  /**
   * ブラウザ専用処理（fetch / DOM操作）はここに隔離。
   * options: { url, targets: {publications:'#sel', fundings:'#sel', awards:'#sel'}, lang, maxItems }
   * maxItems: 各セクションの表示上限件数（省略なら無制限。トップページの「最新N件」表示用）
   * targets のセレクタはセクション要素（例 '#grants'）でよい。要素内に既存の
   * ul.plist/ul.ggrid/ul.alist/ul.gyoseki-list があればその ul のみ差し替え、
   * セクション見出し等は保持する。要素自体が ul ならその ul を置換する。
   * fetch失敗時（ネットワーク断・HTTPエラー・JSON解析失敗）は console.warn のみで
   * 既存表示を維持する（UC-6例外・NFR-04）。
   */
  function init(options) {
    options = options || {};
    var url = options.url;
    var targets = options.targets || {};
    var lang = options.lang;
    var maxItems = options.maxItems;

    if (typeof fetch !== 'function' || typeof document === 'undefined') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('GyosekiRenderer.init: fetch/document unavailable (non-browser environment). Existing display kept.');
      }
      return Promise.resolve(false);
    }

    // initは<head>内で呼ばれ得るため、DOM構築完了を待ってから差し込む
    function whenDomReady() {
      return new Promise(function (resolve) {
        if (document.readyState !== 'loading') { resolve(); return; }
        document.addEventListener('DOMContentLoaded', function () { resolve(); });
      });
    }

    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          throw new Error('HTTP ' + res.status + ' ' + res.statusText);
        }
        return res.json();
      })
      .then(function (data) {
        return whenDomReady().then(function () { return data; });
      })
      .then(function (data) {
        Object.keys(targets).forEach(function (section) {
          if (SECTIONS.indexOf(section) === -1) return;
          var el = document.querySelector(targets[section]);
          if (!el) return;
          var html = buildSectionHTML(data, section, lang, maxItems);
          var existingUl = el.querySelector('ul.plist, ul.ggrid, ul.alist, ul.gyoseki-list');
          if (existingUl) {
            // 前回描画の凡例を先に除く（言語切替などの再描画で凡例が積み重なるのを防ぐ）
            var oldLegend = el.querySelector('.gyoseki-legend');
            if (oldLegend) oldLegend.remove();
            existingUl.outerHTML = html;
          } else if (el.tagName === 'UL') {
            el.outerHTML = html;
          } else {
            el.innerHTML = html;
          }
        });
        return true;
      })
      .catch(function (err) {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('GyosekiRenderer.init: fetch failed, keeping existing display.', err);
        }
        return false;
      });
  }

  return {
    buildSectionHTML: buildSectionHTML,
    init: init
  };
})();

if (typeof module !== 'undefined') {
  module.exports = GyosekiRenderer;
}
