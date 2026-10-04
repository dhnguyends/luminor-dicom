// Highlight the current section in the table of contents
const links = [...document.querySelectorAll('.toc a[href^="#"]')];
const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
const obs = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (e.isIntersecting) {
      links.forEach(a => a.classList.remove('on'));
      byId.get(e.target.id)?.classList.add('on');
    }
  }
}, { rootMargin: '0px 0px -70% 0px' });
document.querySelectorAll('#welcome, h2[id]').forEach(h => obs.observe(h));

// Outside Luminor (e.g. GitHub Pages) there is no local app to open: point to the project instead
const REPO_URL = 'https://github.com/dhnguyends/luminor-dicom';
const isLocal = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
if (!isLocal) {
  document.querySelectorAll('.app-link').forEach(a => {
    a.href = a.dataset.remoteHref || REPO_URL;
    a.textContent = a.dataset.remoteLabel;
  });
}
