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
  if (q.has('go')) { // the home page's way into the game: ?go=london is ?demo=london, a bare ?go is the bare game
    const id = q.get('go') ?? '';
    q.delete('go');
    if (/^[a-z]+$/.test(id)) q.set('demo', id);
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}${location.hash}`);
  }
  if (__LOCAL_ONLY__ && location.pathname.endsWith('/play/')) {
    // served by the online server under /play/: the brand leads back to its home page (a static host elsewhere has none, and the link stays on the game)
    void fetch('../api/config', { cache: 'no-store' }).then((r) => r.ok && r.headers.get('content-type')?.includes('json') && document.getElementById('brand')?.setAttribute('href', '../')).catch(() => {});
  } else if (__LOCAL_ONLY__) document.getElementById('brand')?.removeAttribute('href');
  void import('./main');
}
