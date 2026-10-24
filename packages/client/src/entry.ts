/**
 * The page's one entry (index.html): the home page or the game, decided before either is loaded, so the home page never pulls in
 * three.js and the game never pulls in the home page (docs/demo.md, "The home page").
 *
 *   /                           the home page (landing.ts)
 *   /?go                        the game as a bare page used to be: DEFAULT_DEMO on a showcase, else the join form for the live world
 *   /?go=<demo>                 the same as ?demo=<demo>
 *   /?demo= ?city= ?ws= ?local ?at= ?name= ... any query at all: the game, as before
 *   the static offline build    always the game (`__LOCAL_ONLY__`); the home page is the online server's
 */
const q = new URLSearchParams(location.search);

if (!__LOCAL_ONLY__ && !location.search) {
  document.body.classList.add('landing');
  void import('./landing');
} else {
  document.body.classList.remove('landing');
  const go = q.get('go') ?? '';
  if (/^[a-z]+$/.test(go)) { // the home page's way into the game: ?go=london is ?demo=london (a bare ?go stays in the address, so a reload is the game and not the home page)
    q.delete('go'); q.set('demo', go);
    history.replaceState(null, '', `${location.pathname}?${q}${location.hash}`);
  }
  if (__LOCAL_ONLY__ && location.pathname.endsWith('/play/')) {
    // served by the online server under /play/: the brand leads back to its home page (a static host elsewhere has none, and the link stays on the game)
    void fetch('../api/config', { cache: 'no-store' }).then((r) => r.ok && r.headers.get('content-type')?.includes('json') && document.getElementById('brand')?.setAttribute('href', '../')).catch(() => {});
  } else if (__LOCAL_ONLY__) document.getElementById('brand')?.removeAttribute('href');
  void import('./main');
}
