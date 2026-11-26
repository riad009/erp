/* 🌐 ভাষা (owner): the app is written in Bangla; with English chosen in ⚙️ সেটিং (kept on this phone / computer,
   localStorage kg-khata-lang) /khata/i18n-en.js is loaded too and turns every Bangla piece of text on the screen into English.
   Loaded first in <head> (before the page is drawn), so nothing shows in Bangla first. */
(function(){
  var lang = 'bn';
  try{ lang = localStorage.getItem('kg-khata-lang') === 'en' ? 'en' : 'bn'; }catch(_){}
  window.__lang = lang;
  window.__setLang = function(l){
    try{ localStorage.setItem('kg-khata-lang', l === 'en' ? 'en' : 'bn'); }catch(_){}
    location.reload();
  };
  if(lang !== 'en') return;
  document.documentElement.lang = 'en';
  document.documentElement.className += ' lang-en i18n-wait';
  document.write('<style id="i18nWait">html.i18n-wait body{visibility:hidden}</style>');
  document.write('<script src="/khata/i18n-en.js"><\/script>');
  // never stay hidden (if the English file can't load, show the Bangla page)
  setTimeout(function(){ document.documentElement.classList.remove('i18n-wait'); }, 4000);
})();
