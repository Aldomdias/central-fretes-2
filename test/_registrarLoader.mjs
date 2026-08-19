import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./_loaderExtensao.mjs', pathToFileURL('./test/'));
