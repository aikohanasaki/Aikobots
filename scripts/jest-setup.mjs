import fs from 'node:fs';
import path from 'node:path';

import { setConfigFilePath } from '../src/util.js';

const localConfigPath = path.resolve(process.cwd(), 'config.yaml');
setConfigFilePath(fs.existsSync(localConfigPath)
    ? localConfigPath
    : path.resolve(process.cwd(), '..', 'config.yaml'));
