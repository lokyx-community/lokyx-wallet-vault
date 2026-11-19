// Random numbers for keys, before anything else loads.
import { getRandomValues } from 'expo-crypto';

if (typeof globalThis.crypto === 'undefined') globalThis.crypto = {};
if (typeof globalThis.crypto.getRandomValues !== 'function') globalThis.crypto.getRandomValues = getRandomValues;

import 'expo-router/entry';
