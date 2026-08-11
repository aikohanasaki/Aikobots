import '../lib/structured-clone/monkey-patch.js';
import '../lib/swiped-events.js';
import '../lib/eventemitter.js';

await new Promise(resolve => {
    if (document.readyState === 'complete') {
        resolve();
    } else {
        window.addEventListener('load', resolve, { once: true });
    }
});

await import(/* webpackMode: "eager" */ '../script.js');
