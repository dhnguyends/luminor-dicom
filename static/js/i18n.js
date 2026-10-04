// Interface translations (English / French) and locale-aware number formatting.
//
// t('key', {var}) returns the string for the current language, falling back to English.
// Static markup is translated through attributes:
//   data-i18n="key"              -> textContent
//   data-i18n-title="key"        -> title
//   data-i18n-placeholder="key"  -> placeholder
//   data-i18n-aria="key"         -> aria-label

export const LANGS = { en: 'English', fr: 'Français' };
const LOCALES = { en: 'en-GB', fr: 'fr-FR' };
const STORAGE_KEY = 'luminor.lang';

const en = {
  'app.subtitle': 'CT Viewer',
  'library.aria': 'Series library',
  'search.placeholder': 'Search series',
  'filter.aria': 'Filter by label',
  'filter.all': 'All',
  'filter.cancer': 'Cancer',
  'filter.clear': 'No cancer',
  'library.caption': 'Series',
  'library.list': 'Series',
  'library.count': '{n} of {total}',
  'library.images': '{n} images',
  'library.counting': 'Counting…',
  'library.comparison': 'Comparison',
  'library.more': '{n} more — refine the search.',
  'tag.cancer': 'Cancer',
  'tag.clear': 'Clear',
  'compare.open': 'Open as comparison',

  'toolbar.library': 'Toggle library',
  'toolbar.inspector': 'Toggle inspector',
  'toolbar.cine': 'Play cine (Space)',
  'toolbar.help': 'Keyboard shortcuts (?)',
  'toolbar.lang': 'Passer en français',
  'toolbar.layout': 'Layout',
  'toolbar.plane': 'Plane',
  'toolbar.tools': 'Tools',
  'title.none': 'No series',
  'subtitle.none': 'Choose a series from the library',
  'subtitle.series': '{modality} · {n} images · {mm} mm',

  'layout.single': 'Single',
  'layout.mpr': 'MPR',
  'layout.compare': 'Compare',
  'plane.axial': 'Axial',
  'plane.coronal': 'Coronal',
  'plane.sagittal': 'Sagittal',
  'tool.crosshair': 'Crosshair',
  'tool.wl': 'Window / level',
  'tool.pan': 'Pan',
  'tool.zoom': 'Zoom',
  'tool.length': 'Length',
  'tool.ellipse': 'Ellipse ROI',
  'link.on': 'Linked',
  'link.off': 'Unlinked',
  'link.title': 'Link scrolling and zoom (K)',

  'preset.lung': 'Lung',
  'preset.mediastinum': 'Mediastinum',
  'preset.bone': 'Bone',
  'preset.liver': 'Liver',
  'preset.brain': 'Brain',
  'preset.title': '{name} (C {c}, W {w}) — key {k}',

  'inspector.aria': 'Inspector',
  'inspector.window': 'Window',
  'inspector.center': 'Center',
  'inspector.width': 'Width',
  'inspector.invert': 'Invert (I)',
  'inspector.slab': 'Slab',
  'inspector.slabMode': 'Slab mode',
  'slab.none': 'Off',
  'slab.mip': 'MIP',
  'slab.minip': 'MinIP',
  'slab.avg': 'Avg',
  'inspector.thickness': 'Thickness',
  'inspector.cine': 'Cine',
  'inspector.speed': 'Speed',
  'inspector.fps': '{n} fps',
  'inspector.findings': 'Findings',
  'inspector.marker': 'Marker',
  'inspector.markerTitle': 'Bookmark crosshair position (B)',
  'inspector.keyImage': 'Key image',
  'inspector.keyImageTitle': 'Save key image (PNG)',
  'inspector.report': 'Report',
  'inspector.series': 'Series',

  'info.series': 'Series',
  'info.label': 'Label',
  'info.modality': 'Modality',
  'info.matrix': 'Matrix',
  'info.pixel': 'Pixel',
  'info.spacing': 'Slice spacing',
  'info.hu': 'HU range',
  'info.load': 'Server load',

  'loader.series': 'Opening series',
  'loader.compare': 'Opening comparison',
  'loader.reading': 'Reading DICOM files…',
  'loader.progress': 'Loading volume · {pct}% of {mb} MB',
  'error.volume': 'Volume request failed ({status})',

  'status.none': 'No series open',
  'status.hover': 'Hover the image to read Hounsfield units',
  'status.hint': 'Wheel: scroll · Right-drag: window · Ctrl+wheel: zoom · Double-click: maximize',
  'status.disclaimer': 'Research use only · not for diagnosis',

  'empty.primary.title': 'No series open',
  'empty.primary.text': 'Choose a CT series in the library to start reading.',
  'empty.prior.title': 'No comparison series',
  'empty.prior.text': 'Hover a series in the library and click {icon} to compare it side by side.',

  'label.length': 'Length',
  'label.ellipse': 'ROI',
  'label.point': 'Marker',
  'findings.empty': 'Measure with {ruler} Length (M) or {ellipse} ROI (E), or drop a {pin} marker (B). Findings are saved automatically.',
  'findings.labelAria': 'Finding label',
  'findings.delete': 'Delete',
  'findings.deleteAria': 'Delete finding',
  'findings.location': '{plane} · Im {n} · {axis} {pos} mm',

  'toast.window': '{name} window',
  'toast.marker': 'Marker added at the crosshair',
  'toast.saveFail': 'Could not save findings: {msg}',
  'toast.keyImage': 'Key image saved',
  'toast.opened': 'Opened {id}… · {n} images',
  'toast.openFail': 'Could not open series: {msg}',
  'toast.sameSeries': 'Choose a different series to compare',
  'toast.comparing': 'Comparing with {id}…',
  'toast.compareFail': 'Could not open comparison: {msg}',
  'toast.slab': '{mode} slab · {mm} mm',
  'toast.slabAvg': 'Average',
  'toast.openFirst': 'Open a series first',
  'toast.copied': 'Report copied',
  'toast.copyManual': 'Press Ctrl+C to copy',
  'toast.server': 'Cannot reach the server: {msg}',
  'toast.lang': 'Interface in English',

  'help.title': 'Keyboard & mouse',
  'help.aria': 'Keyboard shortcuts',
  'help.close': 'Close',
  'help.more': 'Everything else (workflows, HU reference, troubleshooting) is in the user guide.',
  'help.guide': 'Open user guide',
  'help.otherGuide': 'Guide en français',
  'guide.href': 'guide.html',
  'guide.otherHref': 'guide-fr.html',
  'guide.otherLang': 'fr',

  'folder.caption': 'Images folder',
  'folder.change': 'Change…',
  'folder.changeTitle': 'Open another folder of medical images',
  'folder.title': 'Medical images folder',
  'folder.help': 'Choose the folder in which each sub-folder holds the .dcm files of one CT series. You can also choose a single series folder: Luminor then opens its parent folder.',
  'folder.pathLabel': 'Folder path',
  'folder.placeholder': 'D:\\scans',
  'folder.browse': 'Browse…',
  'folder.current': 'Current folder:',
  'folder.note': 'Your DICOM files are only read, never modified.',
  'folder.cancel': 'Cancel',
  'folder.open': 'Open folder',
  'folder.opening': 'Opening folder…',
  'folder.err.missing_path': 'Enter a folder path, or click Browse.',
  'folder.err.not_found': 'This folder does not exist: {path}',
  'folder.err.no_series': 'No DICOM series found in {path}. Choose the folder whose sub-folders contain the .dcm files.',
  'folder.err.browse': 'The folder picker is not available here: paste the folder path instead.',
  'folder.err.other': 'Could not open the folder: {msg}',
  'toast.folder': '{n} series in {name}',

  'report.title': 'Report draft',
  'report.aria': 'Report text',
  'report.note': 'Edit freely before copying. Research use only.',
  'report.copy': 'Copy',
  'report.download': 'Download .md',
  'report.file': 'report',

  'hud.im': 'Im',
  'hud.wl': 'C {c}  W {w}',
  'hud.inv': 'INV',
  'hud.badge.compare': 'Compare',
  'hud.slab.mip': 'MIP',
  'hud.slab.minip': 'MINIP',
  'hud.slab.avg': 'AVG',
  'unit.hu': 'HU',
  'snapshot.watermark': 'Luminor · research use only, not for diagnosis',
  'orient.R': 'R', 'orient.L': 'L', 'orient.A': 'A', 'orient.P': 'P', 'orient.S': 'S', 'orient.I': 'I',

  'report.md': {
    title: 'CT report draft',
    series: 'Series',
    modality: 'Modality',
    images: 'Images',
    spacing: 'spacing',
    generated: 'Generated',
    with: 'with Luminor',
    technique: 'Technique',
    techniqueText: 'CT, axial images at {mm} mm spacing; multiplanar reformats reviewed. _Contrast phase and protocol: to be completed._',
    findings: 'Findings',
    none: 'No measured findings recorded.',
    minmax: 'Min / max {min} / {max} HU, {n} pixels',
    impression: 'Impression',
    impressionText: '_To be completed by the reading radiologist._',
    disclaimer: '_Research use only — not a certified medical device; not for diagnostic use._',
  },

  shortcuts: [
    ['Navigation', [
      ['Wheel / ↑ ↓', 'Previous / next image'], ['Shift + wheel', '5 images at a time'],
      ['Page Up / Down', '10 images'], ['Home / End', 'First / last image'],
      ['Space', 'Play / pause cine'], ['A · C · S', 'Axial · coronal · sagittal'],
      ['L', 'Cycle layout (single → MPR → compare)'], ['Double-click', 'Maximize pane'],
    ]],
    ['Display', [
      ['Right-drag', 'Window / level'], ['1 – 5', 'Lung · mediastinum · bone · liver · brain'],
      ['I', 'Invert'], ['Ctrl + wheel', 'Zoom at cursor'], ['Middle-drag', 'Pan'],
      ['R', 'Reset zoom and pan'], ['T', 'Slab: off → MIP → MinIP → Avg'], ['+ / −', 'Slab thickness'],
    ]],
    ['Tools', [
      ['X', 'Crosshair (click to locate in all planes)'], ['W', 'Window / level'], ['H', 'Pan'], ['Z', 'Zoom'],
      ['M', 'Length measurement'], ['E', 'Ellipse ROI (mean, SD, area)'],
    ]],
    ['Findings', [
      ['B', 'Marker at crosshair'], ['Delete', 'Delete selected finding'], ['K', 'Link / unlink comparison'],
      ['Esc', 'Cancel / deselect'], ['?', 'This help'],
    ]],
  ],
};

const fr = {
  'app.subtitle': 'Visionneuse TDM',
  'library.aria': 'Bibliothèque de séries',
  'search.placeholder': 'Rechercher une série',
  'filter.aria': 'Filtrer par étiquette',
  'filter.all': 'Toutes',
  'filter.cancer': 'Cancer',
  'filter.clear': 'Sans cancer',
  'library.caption': 'Séries',
  'library.list': 'Séries',
  'library.count': '{n} sur {total}',
  'library.images': '{n} images',
  'library.counting': 'Comptage…',
  'library.comparison': 'Comparaison',
  'library.more': '{n} de plus — affinez la recherche.',
  'tag.cancer': 'Cancer',
  'tag.clear': 'Négatif',
  'compare.open': 'Ouvrir en comparaison',

  'toolbar.library': 'Afficher ou masquer la bibliothèque',
  'toolbar.inspector': 'Afficher ou masquer l’inspecteur',
  'toolbar.cine': 'Lire le ciné (Espace)',
  'toolbar.help': 'Raccourcis clavier (?)',
  'toolbar.lang': 'Switch to English',
  'toolbar.layout': 'Disposition',
  'toolbar.plane': 'Plan',
  'toolbar.tools': 'Outils',
  'title.none': 'Aucune série',
  'subtitle.none': 'Choisissez une série dans la bibliothèque',
  'subtitle.series': '{modality} · {n} images · {mm} mm',

  'layout.single': 'Simple',
  'layout.mpr': 'MPR',
  'layout.compare': 'Comparaison',
  'plane.axial': 'Axial',
  'plane.coronal': 'Coronal',
  'plane.sagittal': 'Sagittal',
  'tool.crosshair': 'Réticule',
  'tool.wl': 'Fenêtrage',
  'tool.pan': 'Déplacer',
  'tool.zoom': 'Zoom',
  'tool.length': 'Distance',
  'tool.ellipse': 'ROI elliptique',
  'link.on': 'Synchronisé',
  'link.off': 'Désynchronisé',
  'link.title': 'Synchroniser défilement et zoom (K)',

  'preset.lung': 'Poumon',
  'preset.mediastinum': 'Médiastin',
  'preset.bone': 'Os',
  'preset.liver': 'Foie',
  'preset.brain': 'Cerveau',
  'preset.title': '{name} (C {c}, L {w}) — touche {k}',

  'inspector.aria': 'Inspecteur',
  'inspector.window': 'Fenêtre',
  'inspector.center': 'Centre',
  'inspector.width': 'Largeur',
  'inspector.invert': 'Inverser (I)',
  'inspector.slab': 'Coupe épaisse',
  'inspector.slabMode': 'Mode de coupe épaisse',
  'slab.none': 'Non',
  'slab.mip': 'MIP',
  'slab.minip': 'MinIP',
  'slab.avg': 'Moy.',
  'inspector.thickness': 'Épaisseur',
  'inspector.cine': 'Ciné',
  'inspector.speed': 'Vitesse',
  'inspector.fps': '{n} img/s',
  'inspector.findings': 'Observations',
  'inspector.marker': 'Repère',
  'inspector.markerTitle': 'Repère à la position du réticule (B)',
  'inspector.keyImage': 'Image clé',
  'inspector.keyImageTitle': 'Enregistrer une image clé (PNG)',
  'inspector.report': 'Compte rendu',
  'inspector.series': 'Série',

  'info.series': 'Série',
  'info.label': 'Étiquette',
  'info.modality': 'Modalité',
  'info.matrix': 'Matrice',
  'info.pixel': 'Pixel',
  'info.spacing': 'Espacement des coupes',
  'info.hu': 'Plage UH',
  'info.load': 'Chargement serveur',

  'loader.series': 'Ouverture de la série',
  'loader.compare': 'Ouverture de la comparaison',
  'loader.reading': 'Lecture des fichiers DICOM…',
  'loader.progress': 'Chargement du volume · {pct} % de {mb} Mo',
  'error.volume': 'Échec du chargement du volume ({status})',

  'status.none': 'Aucune série ouverte',
  'status.hover': 'Survolez l’image pour lire les unités Hounsfield',
  'status.hint': 'Molette : défiler · Clic droit glissé : fenêtrage · Ctrl + molette : zoom · Double-clic : agrandir',
  'status.disclaimer': 'Usage recherche uniquement · pas de diagnostic',

  'empty.primary.title': 'Aucune série ouverte',
  'empty.primary.text': 'Choisissez une série de scanner dans la bibliothèque pour commencer la lecture.',
  'empty.prior.title': 'Aucune série de comparaison',
  'empty.prior.text': 'Survolez une série dans la bibliothèque et cliquez sur {icon} pour la comparer côte à côte.',

  'label.length': 'Distance',
  'label.ellipse': 'ROI',
  'label.point': 'Repère',
  'findings.empty': 'Mesurez avec {ruler} Distance (M) ou {ellipse} ROI (E), ou posez un {pin} repère (B). Les observations sont enregistrées automatiquement.',
  'findings.labelAria': 'Nom de l’observation',
  'findings.delete': 'Supprimer',
  'findings.deleteAria': 'Supprimer l’observation',
  'findings.location': '{plane} · Im {n} · {axis} {pos} mm',

  'toast.window': 'Fenêtre {name}',
  'toast.marker': 'Repère ajouté à la position du réticule',
  'toast.saveFail': 'Impossible d’enregistrer les observations : {msg}',
  'toast.keyImage': 'Image clé enregistrée',
  'toast.opened': 'Série {id}… ouverte · {n} images',
  'toast.openFail': 'Impossible d’ouvrir la série : {msg}',
  'toast.sameSeries': 'Choisissez une autre série à comparer',
  'toast.comparing': 'Comparaison avec {id}…',
  'toast.compareFail': 'Impossible d’ouvrir la comparaison : {msg}',
  'toast.slab': 'Coupe épaisse {mode} · {mm} mm',
  'toast.slabAvg': 'moyenne',
  'toast.openFirst': 'Ouvrez d’abord une série',
  'toast.copied': 'Compte rendu copié',
  'toast.copyManual': 'Appuyez sur Ctrl+C pour copier',
  'toast.server': 'Serveur injoignable : {msg}',
  'toast.lang': 'Interface en français',

  'help.title': 'Clavier et souris',
  'help.aria': 'Raccourcis clavier',
  'help.close': 'Fermer',
  'help.more': 'Tout le reste (routine de lecture, valeurs UH, dépannage) se trouve dans le guide utilisateur.',
  'help.guide': 'Ouvrir le guide utilisateur',
  'help.otherGuide': 'English guide',
  'guide.href': 'guide-fr.html',
  'guide.otherHref': 'guide.html',
  'guide.otherLang': 'en',

  'folder.caption': 'Dossier d’images',
  'folder.change': 'Changer…',
  'folder.changeTitle': 'Ouvrir un autre dossier d’images médicales',
  'folder.title': 'Dossier d’images médicales',
  'folder.help': 'Choisissez le dossier dans lequel chaque sous-dossier contient les fichiers .dcm d’une série de scanner. Vous pouvez aussi choisir un dossier de série : Luminor ouvre alors son dossier parent.',
  'folder.pathLabel': 'Chemin du dossier',
  'folder.placeholder': 'D:\\examens',
  'folder.browse': 'Parcourir…',
  'folder.current': 'Dossier actuel :',
  'folder.note': 'Vos fichiers DICOM sont seulement lus, jamais modifiés.',
  'folder.cancel': 'Annuler',
  'folder.open': 'Ouvrir le dossier',
  'folder.opening': 'Ouverture du dossier…',
  'folder.err.missing_path': 'Saisissez le chemin d’un dossier, ou cliquez sur Parcourir.',
  'folder.err.not_found': 'Ce dossier n’existe pas : {path}',
  'folder.err.no_series': 'Aucune série DICOM trouvée dans {path}. Choisissez le dossier dont les sous-dossiers contiennent les fichiers .dcm.',
  'folder.err.browse': 'Le sélecteur de dossier n’est pas disponible ici : collez plutôt le chemin du dossier.',
  'folder.err.other': 'Impossible d’ouvrir le dossier : {msg}',
  'toast.folder': '{n} séries dans {name}',

  'report.title': 'Projet de compte rendu',
  'report.aria': 'Texte du compte rendu',
  'report.note': 'Modifiez librement avant de copier. Usage recherche uniquement.',
  'report.copy': 'Copier',
  'report.download': 'Télécharger .md',
  'report.file': 'compte-rendu',

  'hud.im': 'Im',
  'hud.wl': 'C {c}  L {w}',
  'hud.inv': 'INV',
  'hud.badge.compare': 'Comparaison',
  'hud.slab.mip': 'MIP',
  'hud.slab.minip': 'MINIP',
  'hud.slab.avg': 'MOY',
  'unit.hu': 'UH',
  'snapshot.watermark': 'Luminor · usage recherche uniquement, pas de diagnostic',
  // French radiology convention: D (droite) / G (gauche)
  'orient.R': 'D', 'orient.L': 'G', 'orient.A': 'A', 'orient.P': 'P', 'orient.S': 'S', 'orient.I': 'I',

  'report.md': {
    title: 'Projet de compte rendu de scanner',
    series: 'Série',
    modality: 'Modalité',
    images: 'Images',
    spacing: 'espacement',
    generated: 'Généré le',
    with: 'avec Luminor',
    technique: 'Technique',
    techniqueText: 'Scanner, coupes axiales espacées de {mm} mm ; reconstructions multiplanaires examinées. _Temps d’injection et protocole : à compléter._',
    findings: 'Résultats',
    none: 'Aucune observation mesurée.',
    minmax: 'Min / max {min} / {max} UH, {n} pixels',
    impression: 'Conclusion',
    impressionText: '_À compléter par le radiologue._',
    disclaimer: '_Usage recherche uniquement — dispositif non certifié ; ne pas utiliser pour le diagnostic._',
  },

  shortcuts: [
    ['Navigation', [
      ['Molette / ↑ ↓', 'Image précédente / suivante'], ['Maj + molette', '5 images à la fois'],
      ['Page préc. / suiv.', '10 images'], ['Origine / Fin', 'Première / dernière image'],
      ['Espace', 'Lecture / pause du ciné'], ['A · C · S', 'Axial · coronal · sagittal'],
      ['L', 'Changer de disposition (simple → MPR → comparaison)'], ['Double-clic', 'Agrandir la vue'],
    ]],
    ['Affichage', [
      ['Clic droit glissé', 'Fenêtrage'], ['1 – 5', 'Poumon · médiastin · os · foie · cerveau'],
      ['I', 'Inverser'], ['Ctrl + molette', 'Zoom au curseur'], ['Clic central glissé', 'Déplacer'],
      ['R', 'Réinitialiser zoom et déplacement'], ['T', 'Coupe épaisse : non → MIP → MinIP → moy.'], ['+ / −', 'Épaisseur de coupe'],
    ]],
    ['Outils', [
      ['X', 'Réticule (clic pour localiser dans les 3 plans)'], ['W', 'Fenêtrage'], ['H', 'Déplacer'], ['Z', 'Zoom'],
      ['M', 'Mesure de distance'], ['E', 'ROI elliptique (moyenne, écart-type, surface)'],
    ]],
    ['Observations', [
      ['B', 'Repère au réticule'], ['Suppr', 'Supprimer l’observation sélectionnée'], ['K', 'Synchroniser / désynchroniser la comparaison'],
      ['Échap', 'Annuler / désélectionner'], ['?', 'Cette aide'],
    ]],
  ],
};

const DICTS = { en, fr };

function detect() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved in DICTS) return saved;
  } catch { /* storage unavailable */ }
  return (navigator.language || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

let lang = detect();

export function getLang() { return lang; }

export function setLang(next) {
  if (!(next in DICTS)) return;
  lang = next;
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage unavailable */ }
  document.documentElement.lang = next;
}

/** Translated string (or structured value) for key, with {var} interpolation. */
export function t(key, vars) {
  const v = DICTS[lang][key] ?? en[key] ?? key;
  if (typeof v !== 'string' || !vars) return v;
  return v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

/** Locale-aware number with a fixed number of decimals (French uses a decimal comma). */
export function fmt(n, digits = 0) {
  let v = Number(n);
  if (Math.abs(v) < 0.5 * 10 ** -digits) v = 0; // avoid "-0.0"
  return v.toLocaleString(LOCALES[lang], { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function locale() { return LOCALES[lang]; }

/** Apply translations to static markup carrying data-i18n* attributes. */
export function applyStatic(root = document) {
  document.documentElement.lang = lang;
  root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  root.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}
