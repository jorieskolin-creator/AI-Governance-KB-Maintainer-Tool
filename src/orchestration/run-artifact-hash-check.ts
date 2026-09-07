import { canonicalArtifactHash, canonicalArtifactValue } from './artifact-hash.js';

const left = { b: 2, a: 1, nested: { z: 'last', a: 'first' } };
const right = { nested: { a: 'first', z: 'last' }, a: 1, b: 2 };
if (canonicalArtifactHash(left) !== canonicalArtifactHash(right)) {
  throw new Error('Canonical artifact hashing depends on object property order.');
}

const withUndefinedProperty = { a: 1, omitted: undefined };
const persistedUndefinedProperty = JSON.parse(JSON.stringify(withUndefinedProperty));
if (canonicalArtifactHash(withUndefinedProperty) !== canonicalArtifactHash(persistedUndefinedProperty)) {
  throw new Error('Undefined object-property normalization does not match persisted JSON representation.');
}

const withUndefinedArrayItem = ['a', undefined, 'b'];
const persistedUndefinedArrayItem = JSON.parse(JSON.stringify(withUndefinedArrayItem));
if (canonicalArtifactHash(withUndefinedArrayItem) !== canonicalArtifactHash(persistedUndefinedArrayItem)) {
  throw new Error('Undefined array-item normalization does not match persisted JSON representation.');
}

const roundTripInput = {
  object: { beta: true, alpha: null },
  array: [1, 2, 3],
  text: 'stable'
};
const roundTrip = JSON.parse(JSON.stringify(roundTripInput));
if (canonicalArtifactHash(roundTripInput) !== canonicalArtifactHash(roundTrip)) {
  throw new Error('Artifact hash changed across a JSON persistence round trip.');
}

let topLevelUndefinedRejected = false;
try {
  canonicalArtifactHash(undefined);
} catch (error) {
  topLevelUndefinedRejected = error instanceof Error && error.message.includes('no JSON representation');
}
if (!topLevelUndefinedRejected) {
  throw new Error('Top-level undefined artifact was not rejected.');
}

let bigintRejected = false;
try {
  canonicalArtifactHash({ invalid: BigInt(1) });
} catch (error) {
  bigintRejected = error instanceof Error && error.message.includes('not JSON-serializable');
}
if (!bigintRejected) {
  throw new Error('Non-JSON BigInt artifact was not rejected.');
}

const canonical = canonicalArtifactValue({ z: 2, a: 1 });
if (canonical !== '{"a":1,"z":2}') {
  throw new Error(`Unexpected canonical JSON representation: ${canonical}`);
}

console.log(JSON.stringify({
  artifactHashJsonbStability: 'PASS',
  propertyOrderIndependence: 'PASS',
  undefinedObjectPropertyPersistenceParity: 'PASS',
  undefinedArrayItemPersistenceParity: 'PASS',
  jsonRoundTripStability: 'PASS',
  topLevelUndefinedArtifact: 'REJECTED',
  nonJsonBigIntArtifact: 'REJECTED'
}, null, 2));
