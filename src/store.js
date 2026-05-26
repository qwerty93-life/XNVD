const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const storePath = path.join(app.getPath('userData'), 'xnvd-data.json');

function load() {
  try {
    if (fs.existsSync(storePath)) {
      return JSON.parse(fs.readFileSync(storePath, 'utf8'));
    }
  } catch {}
  return {};
}

function save(data) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

let _data = load();

module.exports = {
  get(key) { return key ? _data[key] : _data; },
  set(key, value) {
    _data[key] = value;
    save(_data);
  }
};
