/** Carte fournie par l’extension (message « sup ») ; clés = texte anglais source */
let _map = Object.create(null);

export function setI18nMap(m) {
	_map = m && typeof m === 'object' ? m : Object.create(null);
}

export function t(k) {
	if (_map && Object.prototype.hasOwnProperty.call(_map, k) && _map[k] !== '') {
		return _map[k];
	}
	return k;
}
