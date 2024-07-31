/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015 MinIO, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as crypto from "crypto";
import * as stream from "stream";
import { XMLParser } from 'fast-xml-parser';
import ipaddr from 'ipaddr.js';
import _ from 'lodash';
import * as mime from 'mime-types';
import { fsp, fstat } from "./async.mjs";
import { ENCRYPTION_TYPES } from "./type.mjs";
const MetaDataHeaderPrefix = 'x-amz-meta-';
export function hashBinary(buf, enableSHA256) {
  let sha256sum = '';
  if (enableSHA256) {
    sha256sum = crypto.createHash('sha256').update(buf).digest('hex');
  }
  const md5sum = crypto.createHash('md5').update(buf).digest('base64');
  return {
    md5sum,
    sha256sum
  };
}

// S3 percent-encodes some extra non-standard characters in a URI . So comply with S3.
const encodeAsHex = c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
export function uriEscape(uriStr) {
  return encodeURIComponent(uriStr).replace(/[!'()*]/g, encodeAsHex);
}
export function uriResourceEscape(string) {
  return uriEscape(string).replace(/%2F/g, '/');
}
export function getScope(region, date, serviceName = 's3') {
  return `${makeDateShort(date)}/${region}/${serviceName}/aws4_request`;
}

/**
 * isAmazonEndpoint - true if endpoint is 's3.amazonaws.com' or 's3.cn-north-1.amazonaws.com.cn'
 */
export function isAmazonEndpoint(endpoint) {
  return endpoint === 's3.amazonaws.com' || endpoint === 's3.cn-north-1.amazonaws.com.cn';
}

/**
 * isVirtualHostStyle - verify if bucket name is support with virtual
 * hosts. bucketNames with periods should be always treated as path
 * style if the protocol is 'https:', this is due to SSL wildcard
 * limitation. For all other buckets and Amazon S3 endpoint we will
 * default to virtual host style.
 */
export function isVirtualHostStyle(endpoint, protocol, bucket, pathStyle) {
  if (protocol === 'https:' && bucket.includes('.')) {
    return false;
  }
  return isAmazonEndpoint(endpoint) || !pathStyle;
}
export function isValidIP(ip) {
  return ipaddr.isValid(ip);
}

/**
 * @returns if endpoint is valid domain.
 */
export function isValidEndpoint(endpoint) {
  return isValidDomain(endpoint) || isValidIP(endpoint);
}

/**
 * @returns if input host is a valid domain.
 */
export function isValidDomain(host) {
  if (!isString(host)) {
    return false;
  }
  // See RFC 1035, RFC 3696.
  if (host.length === 0 || host.length > 255) {
    return false;
  }
  // Host cannot start or end with a '-'
  if (host[0] === '-' || host.slice(-1) === '-') {
    return false;
  }
  // Host cannot start or end with a '_'
  if (host[0] === '_' || host.slice(-1) === '_') {
    return false;
  }
  // Host cannot start with a '.'
  if (host[0] === '.') {
    return false;
  }
  const nonAlphaNumerics = '`~!@#$%^&*()+={}[]|\\"\';:><?/';
  // All non alphanumeric characters are invalid.
  for (const char of nonAlphaNumerics) {
    if (host.includes(char)) {
      return false;
    }
  }
  // No need to regexp match, since the list is non-exhaustive.
  // We let it be valid and fail later.
  return true;
}

/**
 * Probes contentType using file extensions.
 *
 * @example
 * ```
 * // return 'image/png'
 * probeContentType('file.png')
 * ```
 */
export function probeContentType(path) {
  let contentType = mime.lookup(path);
  if (!contentType) {
    contentType = 'application/octet-stream';
  }
  return contentType;
}

/**
 * is input port valid.
 */
export function isValidPort(port) {
  // verify if port is a number.
  if (!isNumber(port)) {
    return false;
  }

  // port `0` is valid and special case
  return 0 <= port && port <= 65535;
}
export function isValidBucketName(bucket) {
  if (!isString(bucket)) {
    return false;
  }

  // bucket length should be less than and no more than 63
  // characters long.
  if (bucket.length < 3 || bucket.length > 63) {
    return false;
  }
  // bucket with successive periods is invalid.
  if (bucket.includes('..')) {
    return false;
  }
  // bucket cannot have ip address style.
  if (/[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/.test(bucket)) {
    return false;
  }
  // bucket should begin with alphabet/number and end with alphabet/number,
  // with alphabet/number/.- in the middle.
  if (/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
    return true;
  }
  return false;
}

/**
 * check if objectName is a valid object name
 */
export function isValidObjectName(objectName) {
  if (!isValidPrefix(objectName)) {
    return false;
  }
  return objectName.length !== 0;
}

/**
 * check if prefix is valid
 */
export function isValidPrefix(prefix) {
  if (!isString(prefix)) {
    return false;
  }
  if (prefix.length > 1024) {
    return false;
  }
  return true;
}

/**
 * check if typeof arg number
 */
export function isNumber(arg) {
  return typeof arg === 'number';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any

/**
 * check if typeof arg function
 */
export function isFunction(arg) {
  return typeof arg === 'function';
}

/**
 * check if typeof arg string
 */
export function isString(arg) {
  return typeof arg === 'string';
}

/**
 * check if typeof arg object
 */
export function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

/**
 * check if object is readable stream
 */
export function isReadableStream(arg) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  return isObject(arg) && isFunction(arg._read);
}

/**
 * check if arg is boolean
 */
export function isBoolean(arg) {
  return typeof arg === 'boolean';
}
export function isEmpty(o) {
  return _.isEmpty(o);
}
export function isEmptyObject(o) {
  return Object.values(o).filter(x => x !== undefined).length === 0;
}
export function isDefined(o) {
  return o !== null && o !== undefined;
}

/**
 * check if arg is a valid date
 */
export function isValidDate(arg) {
  // @ts-expect-error checknew Date(Math.NaN)
  return arg instanceof Date && !isNaN(arg);
}

/**
 * Create a Date string with format: 'YYYYMMDDTHHmmss' + Z
 */
export function makeDateLong(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 13) + s.slice(14, 16) + s.slice(17, 19) + 'Z';
}

/**
 * Create a Date string with format: 'YYYYMMDD'
 */
export function makeDateShort(date) {
  date = date || new Date();

  // Gives format like: '2017-08-07T16:28:59.889Z'
  const s = date.toISOString();
  return s.slice(0, 4) + s.slice(5, 7) + s.slice(8, 10);
}

/**
 * pipesetup sets up pipe() from left to right os streams array
 * pipesetup will also make sure that error emitted at any of the upstream Stream
 * will be emitted at the last stream. This makes error handling simple
 */
export function pipesetup(...streams) {
  // @ts-expect-error ts can't narrow this
  return streams.reduce((src, dst) => {
    src.on('error', err => dst.emit('error', err));
    return src.pipe(dst);
  });
}

/**
 * return a Readable stream that emits data
 */
export function readableStream(data) {
  const s = new stream.Readable();
  s._read = () => {};
  s.push(data);
  s.push(null);
  return s;
}

/**
 * Process metadata to insert appropriate value to `content-type` attribute
 */
export function insertContentType(metaData, filePath) {
  // check if content-type attribute present in metaData
  for (const key in metaData) {
    if (key.toLowerCase() === 'content-type') {
      return metaData;
    }
  }

  // if `content-type` attribute is not present in metadata, then infer it from the extension in filePath
  return {
    ...metaData,
    'content-type': probeContentType(filePath)
  };
}

/**
 * Function prepends metadata with the appropriate prefix if it is not already on
 */
export function prependXAMZMeta(metaData) {
  if (!metaData) {
    return {};
  }
  return _.mapKeys(metaData, (value, key) => {
    if (isAmzHeader(key) || isSupportedHeader(key) || isStorageClassHeader(key)) {
      return key;
    }
    return MetaDataHeaderPrefix + key;
  });
}

/**
 * Checks if it is a valid header according to the AmazonS3 API
 */
export function isAmzHeader(key) {
  const temp = key.toLowerCase();
  return temp.startsWith(MetaDataHeaderPrefix) || temp === 'x-amz-acl' || temp.startsWith('x-amz-server-side-encryption-') || temp === 'x-amz-server-side-encryption';
}

/**
 * Checks if it is a supported Header
 */
export function isSupportedHeader(key) {
  const supported_headers = ['content-type', 'cache-control', 'content-encoding', 'content-disposition', 'content-language', 'x-amz-website-redirect-location'];
  return supported_headers.includes(key.toLowerCase());
}

/**
 * Checks if it is a storage header
 */
export function isStorageClassHeader(key) {
  return key.toLowerCase() === 'x-amz-storage-class';
}
export function extractMetadata(headers) {
  return _.mapKeys(_.pickBy(headers, (value, key) => isSupportedHeader(key) || isStorageClassHeader(key) || isAmzHeader(key)), (value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith(MetaDataHeaderPrefix)) {
      return lower.slice(MetaDataHeaderPrefix.length);
    }
    return key;
  });
}
export function getVersionId(headers = {}) {
  return headers['x-amz-version-id'] || null;
}
export function getSourceVersionId(headers = {}) {
  return headers['x-amz-copy-source-version-id'] || null;
}
export function sanitizeETag(etag = '') {
  const replaceChars = {
    '"': '',
    '&quot;': '',
    '&#34;': '',
    '&QUOT;': '',
    '&#x00022': ''
  };
  return etag.replace(/^("|&quot;|&#34;)|("|&quot;|&#34;)$/g, m => replaceChars[m]);
}
export function toMd5(payload) {
  // use string from browser and buffer from nodejs
  // browser support is tested only against minio server
  return crypto.createHash('md5').update(Buffer.from(payload)).digest().toString('base64');
}
export function toSha256(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * toArray returns a single element array with param being the element,
 * if param is just a string, and returns 'param' back if it is an array
 * So, it makes sure param is always an array
 */
export function toArray(param) {
  if (!Array.isArray(param)) {
    return [param];
  }
  return param;
}
export function sanitizeObjectKey(objectName) {
  // + symbol characters are not decoded as spaces in JS. so replace them first and decode to get the correct result.
  const asStrName = (objectName ? objectName.toString() : '').replace(/\+/g, ' ');
  return decodeURIComponent(asStrName);
}
export function sanitizeSize(size) {
  return size ? Number.parseInt(size) : undefined;
}
export const PART_CONSTRAINTS = {
  // absMinPartSize - absolute minimum part size (5 MiB)
  ABS_MIN_PART_SIZE: 1024 * 1024 * 5,
  // MIN_PART_SIZE - minimum part size 16MiB per object after which
  MIN_PART_SIZE: 1024 * 1024 * 16,
  // MAX_PARTS_COUNT - maximum number of parts for a single multipart session.
  MAX_PARTS_COUNT: 10000,
  // MAX_PART_SIZE - maximum part size 5GiB for a single multipart upload
  // operation.
  MAX_PART_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_SINGLE_PUT_OBJECT_SIZE - maximum size 5GiB of object per PUT
  // operation.
  MAX_SINGLE_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 5,
  // MAX_MULTIPART_PUT_OBJECT_SIZE - maximum size 5TiB of object for
  // Multipart operation.
  MAX_MULTIPART_PUT_OBJECT_SIZE: 1024 * 1024 * 1024 * 1024 * 5
};
const GENERIC_SSE_HEADER = 'X-Amz-Server-Side-Encryption';
const SSEC_CUSTOMER_ALGORITHM = `${GENERIC_SSE_HEADER}-Customer-Algorithm`;
const SSEC_CUSTOMER_KEY = `${GENERIC_SSE_HEADER}-Customer-Key`;
const SSEC_CUSTOMER_KEY_MD5 = `${GENERIC_SSE_HEADER}-Customer-Key-MD5`;
const ENCRYPTION_HEADERS = {
  // sseGenericHeader is the AWS SSE header used for SSE-S3 and SSE-KMS.
  sseGenericHeader: GENERIC_SSE_HEADER,
  // sseKmsKeyID is the AWS SSE-KMS key id.
  sseKmsKeyID: GENERIC_SSE_HEADER + '-Aws-Kms-Key-Id',
  sseCCustomerAlgorithm: SSEC_CUSTOMER_ALGORITHM,
  sseCCustomerKey: SSEC_CUSTOMER_KEY,
  sseCCustomerKeyMd5: SSEC_CUSTOMER_KEY_MD5
};

/**
 * Return Encryption headers
 * @param encConfig
 * @returns an object with key value pairs that can be used in headers.
 */
export function getEncryptionHeaders(encConfig) {
  const encType = encConfig.type;
  if (!isEmpty(encType)) {
    if (encType === ENCRYPTION_TYPES.SSEC) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: 'AES256',
        [ENCRYPTION_HEADERS.sseCCustomerAlgorithm]: encConfig.SSECustomerAlgorithm,
        [ENCRYPTION_HEADERS.sseCCustomerKey]: encConfig.SSECustomerKey,
        [ENCRYPTION_HEADERS.sseCCustomerKeyMd5]: encConfig.SSECustomerKeyMD5
      };
    } else if (encType === ENCRYPTION_TYPES.KMS) {
      return {
        [ENCRYPTION_HEADERS.sseGenericHeader]: encConfig.SSEAlgorithm,
        [ENCRYPTION_HEADERS.sseKmsKeyID]: encConfig.KMSMasterKeyID
      };
    }
  }
  return {};
}
export function partsRequired(size) {
  const maxPartSize = PART_CONSTRAINTS.MAX_MULTIPART_PUT_OBJECT_SIZE / (PART_CONSTRAINTS.MAX_PARTS_COUNT - 1);
  let requiredPartSize = size / maxPartSize;
  if (size % maxPartSize > 0) {
    requiredPartSize++;
  }
  requiredPartSize = Math.trunc(requiredPartSize);
  return requiredPartSize;
}

/**
 * calculateEvenSplits - computes splits for a source and returns
 * start and end index slices. Splits happen evenly to be sure that no
 * part is less than 5MiB, as that could fail the multipart request if
 * it is not the last part.
 */
export function calculateEvenSplits(size, objInfo) {
  if (size === 0) {
    return null;
  }
  const reqParts = partsRequired(size);
  const startIndexParts = [];
  const endIndexParts = [];
  let start = objInfo.Start;
  if (isEmpty(start) || start === -1) {
    start = 0;
  }
  const divisorValue = Math.trunc(size / reqParts);
  const reminderValue = size % reqParts;
  let nextStart = start;
  for (let i = 0; i < reqParts; i++) {
    let curPartSize = divisorValue;
    if (i < reminderValue) {
      curPartSize++;
    }
    const currentStart = nextStart;
    const currentEnd = currentStart + curPartSize - 1;
    nextStart = currentEnd + 1;
    startIndexParts.push(currentStart);
    endIndexParts.push(currentEnd);
  }
  return {
    startIndex: startIndexParts,
    endIndex: endIndexParts,
    objInfo: objInfo
  };
}
const fxp = new XMLParser();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseXml(xml) {
  const result = fxp.parse(xml);
  if (result.Error) {
    throw result.Error;
  }
  return result;
}

/**
 * get content size of object content to upload
 */
export async function getContentLength(s) {
  // use length property of string | Buffer
  if (typeof s === 'string' || Buffer.isBuffer(s)) {
    return s.length;
  }

  // property of `fs.ReadStream`
  const filePath = s.path;
  if (filePath && typeof filePath === 'string') {
    const stat = await fsp.lstat(filePath);
    return stat.size;
  }

  // property of `fs.ReadStream`
  const fd = s.fd;
  if (fd && typeof fd === 'number') {
    const stat = await fstat(fd);
    return stat.size;
  }
  return null;
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcnlwdG8iLCJzdHJlYW0iLCJYTUxQYXJzZXIiLCJpcGFkZHIiLCJfIiwibWltZSIsImZzcCIsImZzdGF0IiwiRU5DUllQVElPTl9UWVBFUyIsIk1ldGFEYXRhSGVhZGVyUHJlZml4IiwiaGFzaEJpbmFyeSIsImJ1ZiIsImVuYWJsZVNIQTI1NiIsInNoYTI1NnN1bSIsImNyZWF0ZUhhc2giLCJ1cGRhdGUiLCJkaWdlc3QiLCJtZDVzdW0iLCJlbmNvZGVBc0hleCIsImMiLCJjaGFyQ29kZUF0IiwidG9TdHJpbmciLCJ0b1VwcGVyQ2FzZSIsInVyaUVzY2FwZSIsInVyaVN0ciIsImVuY29kZVVSSUNvbXBvbmVudCIsInJlcGxhY2UiLCJ1cmlSZXNvdXJjZUVzY2FwZSIsInN0cmluZyIsImdldFNjb3BlIiwicmVnaW9uIiwiZGF0ZSIsInNlcnZpY2VOYW1lIiwibWFrZURhdGVTaG9ydCIsImlzQW1hem9uRW5kcG9pbnQiLCJlbmRwb2ludCIsImlzVmlydHVhbEhvc3RTdHlsZSIsInByb3RvY29sIiwiYnVja2V0IiwicGF0aFN0eWxlIiwiaW5jbHVkZXMiLCJpc1ZhbGlkSVAiLCJpcCIsImlzVmFsaWQiLCJpc1ZhbGlkRW5kcG9pbnQiLCJpc1ZhbGlkRG9tYWluIiwiaG9zdCIsImlzU3RyaW5nIiwibGVuZ3RoIiwic2xpY2UiLCJub25BbHBoYU51bWVyaWNzIiwiY2hhciIsInByb2JlQ29udGVudFR5cGUiLCJwYXRoIiwiY29udGVudFR5cGUiLCJsb29rdXAiLCJpc1ZhbGlkUG9ydCIsInBvcnQiLCJpc051bWJlciIsImlzVmFsaWRCdWNrZXROYW1lIiwidGVzdCIsImlzVmFsaWRPYmplY3ROYW1lIiwib2JqZWN0TmFtZSIsImlzVmFsaWRQcmVmaXgiLCJwcmVmaXgiLCJhcmciLCJpc0Z1bmN0aW9uIiwiaXNPYmplY3QiLCJpc1JlYWRhYmxlU3RyZWFtIiwiX3JlYWQiLCJpc0Jvb2xlYW4iLCJpc0VtcHR5IiwibyIsImlzRW1wdHlPYmplY3QiLCJPYmplY3QiLCJ2YWx1ZXMiLCJmaWx0ZXIiLCJ4IiwidW5kZWZpbmVkIiwiaXNEZWZpbmVkIiwiaXNWYWxpZERhdGUiLCJEYXRlIiwiaXNOYU4iLCJtYWtlRGF0ZUxvbmciLCJzIiwidG9JU09TdHJpbmciLCJwaXBlc2V0dXAiLCJzdHJlYW1zIiwicmVkdWNlIiwic3JjIiwiZHN0Iiwib24iLCJlcnIiLCJlbWl0IiwicGlwZSIsInJlYWRhYmxlU3RyZWFtIiwiZGF0YSIsIlJlYWRhYmxlIiwicHVzaCIsImluc2VydENvbnRlbnRUeXBlIiwibWV0YURhdGEiLCJmaWxlUGF0aCIsImtleSIsInRvTG93ZXJDYXNlIiwicHJlcGVuZFhBTVpNZXRhIiwibWFwS2V5cyIsInZhbHVlIiwiaXNBbXpIZWFkZXIiLCJpc1N1cHBvcnRlZEhlYWRlciIsImlzU3RvcmFnZUNsYXNzSGVhZGVyIiwidGVtcCIsInN0YXJ0c1dpdGgiLCJzdXBwb3J0ZWRfaGVhZGVycyIsImV4dHJhY3RNZXRhZGF0YSIsImhlYWRlcnMiLCJwaWNrQnkiLCJsb3dlciIsImdldFZlcnNpb25JZCIsImdldFNvdXJjZVZlcnNpb25JZCIsInNhbml0aXplRVRhZyIsImV0YWciLCJyZXBsYWNlQ2hhcnMiLCJtIiwidG9NZDUiLCJwYXlsb2FkIiwiQnVmZmVyIiwiZnJvbSIsInRvU2hhMjU2IiwidG9BcnJheSIsInBhcmFtIiwiQXJyYXkiLCJpc0FycmF5Iiwic2FuaXRpemVPYmplY3RLZXkiLCJhc1N0ck5hbWUiLCJkZWNvZGVVUklDb21wb25lbnQiLCJzYW5pdGl6ZVNpemUiLCJzaXplIiwiTnVtYmVyIiwicGFyc2VJbnQiLCJQQVJUX0NPTlNUUkFJTlRTIiwiQUJTX01JTl9QQVJUX1NJWkUiLCJNSU5fUEFSVF9TSVpFIiwiTUFYX1BBUlRTX0NPVU5UIiwiTUFYX1BBUlRfU0laRSIsIk1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFIiwiTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUiLCJHRU5FUklDX1NTRV9IRUFERVIiLCJTU0VDX0NVU1RPTUVSX0FMR09SSVRITSIsIlNTRUNfQ1VTVE9NRVJfS0VZIiwiU1NFQ19DVVNUT01FUl9LRVlfTUQ1IiwiRU5DUllQVElPTl9IRUFERVJTIiwic3NlR2VuZXJpY0hlYWRlciIsInNzZUttc0tleUlEIiwic3NlQ0N1c3RvbWVyQWxnb3JpdGhtIiwic3NlQ0N1c3RvbWVyS2V5Iiwic3NlQ0N1c3RvbWVyS2V5TWQ1IiwiZ2V0RW5jcnlwdGlvbkhlYWRlcnMiLCJlbmNDb25maWciLCJlbmNUeXBlIiwidHlwZSIsIlNTRUMiLCJTU0VDdXN0b21lckFsZ29yaXRobSIsIlNTRUN1c3RvbWVyS2V5IiwiU1NFQ3VzdG9tZXJLZXlNRDUiLCJLTVMiLCJTU0VBbGdvcml0aG0iLCJLTVNNYXN0ZXJLZXlJRCIsInBhcnRzUmVxdWlyZWQiLCJtYXhQYXJ0U2l6ZSIsInJlcXVpcmVkUGFydFNpemUiLCJNYXRoIiwidHJ1bmMiLCJjYWxjdWxhdGVFdmVuU3BsaXRzIiwib2JqSW5mbyIsInJlcVBhcnRzIiwic3RhcnRJbmRleFBhcnRzIiwiZW5kSW5kZXhQYXJ0cyIsInN0YXJ0IiwiU3RhcnQiLCJkaXZpc29yVmFsdWUiLCJyZW1pbmRlclZhbHVlIiwibmV4dFN0YXJ0IiwiaSIsImN1clBhcnRTaXplIiwiY3VycmVudFN0YXJ0IiwiY3VycmVudEVuZCIsInN0YXJ0SW5kZXgiLCJlbmRJbmRleCIsImZ4cCIsInBhcnNlWG1sIiwieG1sIiwicmVzdWx0IiwicGFyc2UiLCJFcnJvciIsImdldENvbnRlbnRMZW5ndGgiLCJpc0J1ZmZlciIsInN0YXQiLCJsc3RhdCIsImZkIl0sInNvdXJjZXMiOlsiaGVscGVyLnRzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gKiBNaW5JTyBKYXZhc2NyaXB0IExpYnJhcnkgZm9yIEFtYXpvbiBTMyBDb21wYXRpYmxlIENsb3VkIFN0b3JhZ2UsIChDKSAyMDE1IE1pbklPLCBJbmMuXG4gKlxuICogTGljZW5zZWQgdW5kZXIgdGhlIEFwYWNoZSBMaWNlbnNlLCBWZXJzaW9uIDIuMCAodGhlIFwiTGljZW5zZVwiKTtcbiAqIHlvdSBtYXkgbm90IHVzZSB0aGlzIGZpbGUgZXhjZXB0IGluIGNvbXBsaWFuY2Ugd2l0aCB0aGUgTGljZW5zZS5cbiAqIFlvdSBtYXkgb2J0YWluIGEgY29weSBvZiB0aGUgTGljZW5zZSBhdFxuICpcbiAqICAgICBodHRwOi8vd3d3LmFwYWNoZS5vcmcvbGljZW5zZXMvTElDRU5TRS0yLjBcbiAqXG4gKiBVbmxlc3MgcmVxdWlyZWQgYnkgYXBwbGljYWJsZSBsYXcgb3IgYWdyZWVkIHRvIGluIHdyaXRpbmcsIHNvZnR3YXJlXG4gKiBkaXN0cmlidXRlZCB1bmRlciB0aGUgTGljZW5zZSBpcyBkaXN0cmlidXRlZCBvbiBhbiBcIkFTIElTXCIgQkFTSVMsXG4gKiBXSVRIT1VUIFdBUlJBTlRJRVMgT1IgQ09ORElUSU9OUyBPRiBBTlkgS0lORCwgZWl0aGVyIGV4cHJlc3Mgb3IgaW1wbGllZC5cbiAqIFNlZSB0aGUgTGljZW5zZSBmb3IgdGhlIHNwZWNpZmljIGxhbmd1YWdlIGdvdmVybmluZyBwZXJtaXNzaW9ucyBhbmRcbiAqIGxpbWl0YXRpb25zIHVuZGVyIHRoZSBMaWNlbnNlLlxuICovXG5cbmltcG9ydCAqIGFzIGNyeXB0byBmcm9tICdub2RlOmNyeXB0bydcbmltcG9ydCAqIGFzIHN0cmVhbSBmcm9tICdub2RlOnN0cmVhbSdcblxuaW1wb3J0IHsgWE1MUGFyc2VyIH0gZnJvbSAnZmFzdC14bWwtcGFyc2VyJ1xuaW1wb3J0IGlwYWRkciBmcm9tICdpcGFkZHIuanMnXG5pbXBvcnQgXyBmcm9tICdsb2Rhc2gnXG5pbXBvcnQgKiBhcyBtaW1lIGZyb20gJ21pbWUtdHlwZXMnXG5cbmltcG9ydCB7IGZzcCwgZnN0YXQgfSBmcm9tICcuL2FzeW5jLnRzJ1xuaW1wb3J0IHR5cGUgeyBCaW5hcnksIEVuY3J5cHRpb24sIE9iamVjdE1ldGFEYXRhLCBSZXF1ZXN0SGVhZGVycywgUmVzcG9uc2VIZWFkZXIgfSBmcm9tICcuL3R5cGUudHMnXG5pbXBvcnQgeyBFTkNSWVBUSU9OX1RZUEVTIH0gZnJvbSAnLi90eXBlLnRzJ1xuXG5jb25zdCBNZXRhRGF0YUhlYWRlclByZWZpeCA9ICd4LWFtei1tZXRhLSdcblxuZXhwb3J0IGZ1bmN0aW9uIGhhc2hCaW5hcnkoYnVmOiBCdWZmZXIsIGVuYWJsZVNIQTI1NjogYm9vbGVhbikge1xuICBsZXQgc2hhMjU2c3VtID0gJydcbiAgaWYgKGVuYWJsZVNIQTI1Nikge1xuICAgIHNoYTI1NnN1bSA9IGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUoYnVmKS5kaWdlc3QoJ2hleCcpXG4gIH1cbiAgY29uc3QgbWQ1c3VtID0gY3J5cHRvLmNyZWF0ZUhhc2goJ21kNScpLnVwZGF0ZShidWYpLmRpZ2VzdCgnYmFzZTY0JylcblxuICByZXR1cm4geyBtZDVzdW0sIHNoYTI1NnN1bSB9XG59XG5cbi8vIFMzIHBlcmNlbnQtZW5jb2RlcyBzb21lIGV4dHJhIG5vbi1zdGFuZGFyZCBjaGFyYWN0ZXJzIGluIGEgVVJJIC4gU28gY29tcGx5IHdpdGggUzMuXG5jb25zdCBlbmNvZGVBc0hleCA9IChjOiBzdHJpbmcpID0+IGAlJHtjLmNoYXJDb2RlQXQoMCkudG9TdHJpbmcoMTYpLnRvVXBwZXJDYXNlKCl9YFxuZXhwb3J0IGZ1bmN0aW9uIHVyaUVzY2FwZSh1cmlTdHI6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBlbmNvZGVVUklDb21wb25lbnQodXJpU3RyKS5yZXBsYWNlKC9bIScoKSpdL2csIGVuY29kZUFzSGV4KVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdXJpUmVzb3VyY2VFc2NhcGUoc3RyaW5nOiBzdHJpbmcpIHtcbiAgcmV0dXJuIHVyaUVzY2FwZShzdHJpbmcpLnJlcGxhY2UoLyUyRi9nLCAnLycpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTY29wZShyZWdpb246IHN0cmluZywgZGF0ZTogRGF0ZSwgc2VydmljZU5hbWUgPSAnczMnKSB7XG4gIHJldHVybiBgJHttYWtlRGF0ZVNob3J0KGRhdGUpfS8ke3JlZ2lvbn0vJHtzZXJ2aWNlTmFtZX0vYXdzNF9yZXF1ZXN0YFxufVxuXG4vKipcbiAqIGlzQW1hem9uRW5kcG9pbnQgLSB0cnVlIGlmIGVuZHBvaW50IGlzICdzMy5hbWF6b25hd3MuY29tJyBvciAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbWF6b25FbmRwb2ludChlbmRwb2ludDogc3RyaW5nKSB7XG4gIHJldHVybiBlbmRwb2ludCA9PT0gJ3MzLmFtYXpvbmF3cy5jb20nIHx8IGVuZHBvaW50ID09PSAnczMuY24tbm9ydGgtMS5hbWF6b25hd3MuY29tLmNuJ1xufVxuXG4vKipcbiAqIGlzVmlydHVhbEhvc3RTdHlsZSAtIHZlcmlmeSBpZiBidWNrZXQgbmFtZSBpcyBzdXBwb3J0IHdpdGggdmlydHVhbFxuICogaG9zdHMuIGJ1Y2tldE5hbWVzIHdpdGggcGVyaW9kcyBzaG91bGQgYmUgYWx3YXlzIHRyZWF0ZWQgYXMgcGF0aFxuICogc3R5bGUgaWYgdGhlIHByb3RvY29sIGlzICdodHRwczonLCB0aGlzIGlzIGR1ZSB0byBTU0wgd2lsZGNhcmRcbiAqIGxpbWl0YXRpb24uIEZvciBhbGwgb3RoZXIgYnVja2V0cyBhbmQgQW1hem9uIFMzIGVuZHBvaW50IHdlIHdpbGxcbiAqIGRlZmF1bHQgdG8gdmlydHVhbCBob3N0IHN0eWxlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWaXJ0dWFsSG9zdFN0eWxlKGVuZHBvaW50OiBzdHJpbmcsIHByb3RvY29sOiBzdHJpbmcsIGJ1Y2tldDogc3RyaW5nLCBwYXRoU3R5bGU6IGJvb2xlYW4pIHtcbiAgaWYgKHByb3RvY29sID09PSAnaHR0cHM6JyAmJiBidWNrZXQuaW5jbHVkZXMoJy4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIHJldHVybiBpc0FtYXpvbkVuZHBvaW50KGVuZHBvaW50KSB8fCAhcGF0aFN0eWxlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkSVAoaXA6IHN0cmluZykge1xuICByZXR1cm4gaXBhZGRyLmlzVmFsaWQoaXApXG59XG5cbi8qKlxuICogQHJldHVybnMgaWYgZW5kcG9pbnQgaXMgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZEVuZHBvaW50KGVuZHBvaW50OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGlzVmFsaWREb21haW4oZW5kcG9pbnQpIHx8IGlzVmFsaWRJUChlbmRwb2ludClcbn1cblxuLyoqXG4gKiBAcmV0dXJucyBpZiBpbnB1dCBob3N0IGlzIGEgdmFsaWQgZG9tYWluLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZERvbWFpbihob3N0OiBzdHJpbmcpIHtcbiAgaWYgKCFpc1N0cmluZyhob3N0KSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIFNlZSBSRkMgMTAzNSwgUkZDIDM2OTYuXG4gIGlmIChob3N0Lmxlbmd0aCA9PT0gMCB8fCBob3N0Lmxlbmd0aCA+IDI1NSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJy0nXG4gIGlmIChob3N0WzBdID09PSAnLScgfHwgaG9zdC5zbGljZSgtMSkgPT09ICctJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IG9yIGVuZCB3aXRoIGEgJ18nXG4gIGlmIChob3N0WzBdID09PSAnXycgfHwgaG9zdC5zbGljZSgtMSkgPT09ICdfJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIEhvc3QgY2Fubm90IHN0YXJ0IHdpdGggYSAnLidcbiAgaWYgKGhvc3RbMF0gPT09ICcuJykge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgY29uc3Qgbm9uQWxwaGFOdW1lcmljcyA9ICdgfiFAIyQlXiYqKCkrPXt9W118XFxcXFwiXFwnOzo+PD8vJ1xuICAvLyBBbGwgbm9uIGFscGhhbnVtZXJpYyBjaGFyYWN0ZXJzIGFyZSBpbnZhbGlkLlxuICBmb3IgKGNvbnN0IGNoYXIgb2Ygbm9uQWxwaGFOdW1lcmljcykge1xuICAgIGlmIChob3N0LmluY2x1ZGVzKGNoYXIpKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgLy8gTm8gbmVlZCB0byByZWdleHAgbWF0Y2gsIHNpbmNlIHRoZSBsaXN0IGlzIG5vbi1leGhhdXN0aXZlLlxuICAvLyBXZSBsZXQgaXQgYmUgdmFsaWQgYW5kIGZhaWwgbGF0ZXIuXG4gIHJldHVybiB0cnVlXG59XG5cbi8qKlxuICogUHJvYmVzIGNvbnRlbnRUeXBlIHVzaW5nIGZpbGUgZXh0ZW5zaW9ucy5cbiAqXG4gKiBAZXhhbXBsZVxuICogYGBgXG4gKiAvLyByZXR1cm4gJ2ltYWdlL3BuZydcbiAqIHByb2JlQ29udGVudFR5cGUoJ2ZpbGUucG5nJylcbiAqIGBgYFxuICovXG5leHBvcnQgZnVuY3Rpb24gcHJvYmVDb250ZW50VHlwZShwYXRoOiBzdHJpbmcpIHtcbiAgbGV0IGNvbnRlbnRUeXBlID0gbWltZS5sb29rdXAocGF0aClcbiAgaWYgKCFjb250ZW50VHlwZSkge1xuICAgIGNvbnRlbnRUeXBlID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgfVxuICByZXR1cm4gY29udGVudFR5cGVcbn1cblxuLyoqXG4gKiBpcyBpbnB1dCBwb3J0IHZhbGlkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFBvcnQocG9ydDogdW5rbm93bik6IHBvcnQgaXMgbnVtYmVyIHtcbiAgLy8gdmVyaWZ5IGlmIHBvcnQgaXMgYSBudW1iZXIuXG4gIGlmICghaXNOdW1iZXIocG9ydCkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIHBvcnQgYDBgIGlzIHZhbGlkIGFuZCBzcGVjaWFsIGNhc2VcbiAgcmV0dXJuIDAgPD0gcG9ydCAmJiBwb3J0IDw9IDY1NTM1XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkQnVja2V0TmFtZShidWNrZXQ6IHVua25vd24pIHtcbiAgaWYgKCFpc1N0cmluZyhidWNrZXQpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBidWNrZXQgbGVuZ3RoIHNob3VsZCBiZSBsZXNzIHRoYW4gYW5kIG5vIG1vcmUgdGhhbiA2M1xuICAvLyBjaGFyYWN0ZXJzIGxvbmcuXG4gIGlmIChidWNrZXQubGVuZ3RoIDwgMyB8fCBidWNrZXQubGVuZ3RoID4gNjMpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuICAvLyBidWNrZXQgd2l0aCBzdWNjZXNzaXZlIHBlcmlvZHMgaXMgaW52YWxpZC5cbiAgaWYgKGJ1Y2tldC5pbmNsdWRlcygnLi4nKSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG4gIC8vIGJ1Y2tldCBjYW5ub3QgaGF2ZSBpcCBhZGRyZXNzIHN0eWxlLlxuICBpZiAoL1swLTldK1xcLlswLTldK1xcLlswLTldK1xcLlswLTldKy8udGVzdChidWNrZXQpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgLy8gYnVja2V0IHNob3VsZCBiZWdpbiB3aXRoIGFscGhhYmV0L251bWJlciBhbmQgZW5kIHdpdGggYWxwaGFiZXQvbnVtYmVyLFxuICAvLyB3aXRoIGFscGhhYmV0L251bWJlci8uLSBpbiB0aGUgbWlkZGxlLlxuICBpZiAoL15bYS16MC05XVthLXowLTkuLV0rW2EtejAtOV0kLy50ZXN0KGJ1Y2tldCkpIHtcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG4gIHJldHVybiBmYWxzZVxufVxuXG4vKipcbiAqIGNoZWNrIGlmIG9iamVjdE5hbWUgaXMgYSB2YWxpZCBvYmplY3QgbmFtZVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZE9iamVjdE5hbWUob2JqZWN0TmFtZTogdW5rbm93bikge1xuICBpZiAoIWlzVmFsaWRQcmVmaXgob2JqZWN0TmFtZSkpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBvYmplY3ROYW1lLmxlbmd0aCAhPT0gMFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIHByZWZpeCBpcyB2YWxpZFxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNWYWxpZFByZWZpeChwcmVmaXg6IHVua25vd24pOiBwcmVmaXggaXMgc3RyaW5nIHtcbiAgaWYgKCFpc1N0cmluZyhwcmVmaXgpKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgaWYgKHByZWZpeC5sZW5ndGggPiAxMDI0KSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbiAgcmV0dXJuIHRydWVcbn1cblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIG51bWJlclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNOdW1iZXIoYXJnOiB1bmtub3duKTogYXJnIGlzIG51bWJlciB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnbnVtYmVyJ1xufVxuXG4vLyBlc2xpbnQtZGlzYWJsZS1uZXh0LWxpbmUgQHR5cGVzY3JpcHQtZXNsaW50L25vLWV4cGxpY2l0LWFueVxuZXhwb3J0IHR5cGUgQW55RnVuY3Rpb24gPSAoLi4uYXJnczogYW55W10pID0+IGFueVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgZnVuY3Rpb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzRnVuY3Rpb24oYXJnOiB1bmtub3duKTogYXJnIGlzIEFueUZ1bmN0aW9uIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbidcbn1cblxuLyoqXG4gKiBjaGVjayBpZiB0eXBlb2YgYXJnIHN0cmluZ1xuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdHJpbmcoYXJnOiB1bmtub3duKTogYXJnIGlzIHN0cmluZyB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnc3RyaW5nJ1xufVxuXG4vKipcbiAqIGNoZWNrIGlmIHR5cGVvZiBhcmcgb2JqZWN0XG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc09iamVjdChhcmc6IHVua25vd24pOiBhcmcgaXMgb2JqZWN0IHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdvYmplY3QnICYmIGFyZyAhPT0gbnVsbFxufVxuXG4vKipcbiAqIGNoZWNrIGlmIG9iamVjdCBpcyByZWFkYWJsZSBzdHJlYW1cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzUmVhZGFibGVTdHJlYW0oYXJnOiB1bmtub3duKTogYXJnIGlzIHN0cmVhbS5SZWFkYWJsZSB7XG4gIC8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvdW5ib3VuZC1tZXRob2RcbiAgcmV0dXJuIGlzT2JqZWN0KGFyZykgJiYgaXNGdW5jdGlvbigoYXJnIGFzIHN0cmVhbS5SZWFkYWJsZSkuX3JlYWQpXG59XG5cbi8qKlxuICogY2hlY2sgaWYgYXJnIGlzIGJvb2xlYW5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzQm9vbGVhbihhcmc6IHVua25vd24pOiBhcmcgaXMgYm9vbGVhbiB7XG4gIHJldHVybiB0eXBlb2YgYXJnID09PSAnYm9vbGVhbidcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHkobzogdW5rbm93bik6IG8gaXMgbnVsbCB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBfLmlzRW1wdHkobylcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzRW1wdHlPYmplY3QobzogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBib29sZWFuIHtcbiAgcmV0dXJuIE9iamVjdC52YWx1ZXMobykuZmlsdGVyKCh4KSA9PiB4ICE9PSB1bmRlZmluZWQpLmxlbmd0aCA9PT0gMFxufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNEZWZpbmVkPFQ+KG86IFQpOiBvIGlzIEV4Y2x1ZGU8VCwgbnVsbCB8IHVuZGVmaW5lZD4ge1xuICByZXR1cm4gbyAhPT0gbnVsbCAmJiBvICE9PSB1bmRlZmluZWRcbn1cblxuLyoqXG4gKiBjaGVjayBpZiBhcmcgaXMgYSB2YWxpZCBkYXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1ZhbGlkRGF0ZShhcmc6IHVua25vd24pOiBhcmcgaXMgRGF0ZSB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgY2hlY2tuZXcgRGF0ZShNYXRoLk5hTilcbiAgcmV0dXJuIGFyZyBpbnN0YW5jZW9mIERhdGUgJiYgIWlzTmFOKGFyZylcbn1cblxuLyoqXG4gKiBDcmVhdGUgYSBEYXRlIHN0cmluZyB3aXRoIGZvcm1hdDogJ1lZWVlNTUREVEhIbW1zcycgKyBaXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRGF0ZUxvbmcoZGF0ZT86IERhdGUpOiBzdHJpbmcge1xuICBkYXRlID0gZGF0ZSB8fCBuZXcgRGF0ZSgpXG5cbiAgLy8gR2l2ZXMgZm9ybWF0IGxpa2U6ICcyMDE3LTA4LTA3VDE2OjI4OjU5Ljg4OVonXG4gIGNvbnN0IHMgPSBkYXRlLnRvSVNPU3RyaW5nKClcblxuICByZXR1cm4gcy5zbGljZSgwLCA0KSArIHMuc2xpY2UoNSwgNykgKyBzLnNsaWNlKDgsIDEzKSArIHMuc2xpY2UoMTQsIDE2KSArIHMuc2xpY2UoMTcsIDE5KSArICdaJ1xufVxuXG4vKipcbiAqIENyZWF0ZSBhIERhdGUgc3RyaW5nIHdpdGggZm9ybWF0OiAnWVlZWU1NREQnXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYWtlRGF0ZVNob3J0KGRhdGU/OiBEYXRlKSB7XG4gIGRhdGUgPSBkYXRlIHx8IG5ldyBEYXRlKClcblxuICAvLyBHaXZlcyBmb3JtYXQgbGlrZTogJzIwMTctMDgtMDdUMTY6Mjg6NTkuODg5WidcbiAgY29uc3QgcyA9IGRhdGUudG9JU09TdHJpbmcoKVxuXG4gIHJldHVybiBzLnNsaWNlKDAsIDQpICsgcy5zbGljZSg1LCA3KSArIHMuc2xpY2UoOCwgMTApXG59XG5cbi8qKlxuICogcGlwZXNldHVwIHNldHMgdXAgcGlwZSgpIGZyb20gbGVmdCB0byByaWdodCBvcyBzdHJlYW1zIGFycmF5XG4gKiBwaXBlc2V0dXAgd2lsbCBhbHNvIG1ha2Ugc3VyZSB0aGF0IGVycm9yIGVtaXR0ZWQgYXQgYW55IG9mIHRoZSB1cHN0cmVhbSBTdHJlYW1cbiAqIHdpbGwgYmUgZW1pdHRlZCBhdCB0aGUgbGFzdCBzdHJlYW0uIFRoaXMgbWFrZXMgZXJyb3IgaGFuZGxpbmcgc2ltcGxlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwaXBlc2V0dXAoLi4uc3RyZWFtczogW3N0cmVhbS5SZWFkYWJsZSwgLi4uc3RyZWFtLkR1cGxleFtdLCBzdHJlYW0uV3JpdGFibGVdKSB7XG4gIC8vIEB0cy1leHBlY3QtZXJyb3IgdHMgY2FuJ3QgbmFycm93IHRoaXNcbiAgcmV0dXJuIHN0cmVhbXMucmVkdWNlKChzcmM6IHN0cmVhbS5SZWFkYWJsZSwgZHN0OiBzdHJlYW0uV3JpdGFibGUpID0+IHtcbiAgICBzcmMub24oJ2Vycm9yJywgKGVycikgPT4gZHN0LmVtaXQoJ2Vycm9yJywgZXJyKSlcbiAgICByZXR1cm4gc3JjLnBpcGUoZHN0KVxuICB9KVxufVxuXG4vKipcbiAqIHJldHVybiBhIFJlYWRhYmxlIHN0cmVhbSB0aGF0IGVtaXRzIGRhdGFcbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlYWRhYmxlU3RyZWFtKGRhdGE6IHVua25vd24pOiBzdHJlYW0uUmVhZGFibGUge1xuICBjb25zdCBzID0gbmV3IHN0cmVhbS5SZWFkYWJsZSgpXG4gIHMuX3JlYWQgPSAoKSA9PiB7fVxuICBzLnB1c2goZGF0YSlcbiAgcy5wdXNoKG51bGwpXG4gIHJldHVybiBzXG59XG5cbi8qKlxuICogUHJvY2VzcyBtZXRhZGF0YSB0byBpbnNlcnQgYXBwcm9wcmlhdGUgdmFsdWUgdG8gYGNvbnRlbnQtdHlwZWAgYXR0cmlidXRlXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpbnNlcnRDb250ZW50VHlwZShtZXRhRGF0YTogT2JqZWN0TWV0YURhdGEsIGZpbGVQYXRoOiBzdHJpbmcpOiBPYmplY3RNZXRhRGF0YSB7XG4gIC8vIGNoZWNrIGlmIGNvbnRlbnQtdHlwZSBhdHRyaWJ1dGUgcHJlc2VudCBpbiBtZXRhRGF0YVxuICBmb3IgKGNvbnN0IGtleSBpbiBtZXRhRGF0YSkge1xuICAgIGlmIChrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgIHJldHVybiBtZXRhRGF0YVxuICAgIH1cbiAgfVxuXG4gIC8vIGlmIGBjb250ZW50LXR5cGVgIGF0dHJpYnV0ZSBpcyBub3QgcHJlc2VudCBpbiBtZXRhZGF0YSwgdGhlbiBpbmZlciBpdCBmcm9tIHRoZSBleHRlbnNpb24gaW4gZmlsZVBhdGhcbiAgcmV0dXJuIHtcbiAgICAuLi5tZXRhRGF0YSxcbiAgICAnY29udGVudC10eXBlJzogcHJvYmVDb250ZW50VHlwZShmaWxlUGF0aCksXG4gIH1cbn1cblxuLyoqXG4gKiBGdW5jdGlvbiBwcmVwZW5kcyBtZXRhZGF0YSB3aXRoIHRoZSBhcHByb3ByaWF0ZSBwcmVmaXggaWYgaXQgaXMgbm90IGFscmVhZHkgb25cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByZXBlbmRYQU1aTWV0YShtZXRhRGF0YT86IE9iamVjdE1ldGFEYXRhKTogUmVxdWVzdEhlYWRlcnMge1xuICBpZiAoIW1ldGFEYXRhKSB7XG4gICAgcmV0dXJuIHt9XG4gIH1cblxuICByZXR1cm4gXy5tYXBLZXlzKG1ldGFEYXRhLCAodmFsdWUsIGtleSkgPT4ge1xuICAgIGlmIChpc0FtekhlYWRlcihrZXkpIHx8IGlzU3VwcG9ydGVkSGVhZGVyKGtleSkgfHwgaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5KSkge1xuICAgICAgcmV0dXJuIGtleVxuICAgIH1cblxuICAgIHJldHVybiBNZXRhRGF0YUhlYWRlclByZWZpeCArIGtleVxuICB9KVxufVxuXG4vKipcbiAqIENoZWNrcyBpZiBpdCBpcyBhIHZhbGlkIGhlYWRlciBhY2NvcmRpbmcgdG8gdGhlIEFtYXpvblMzIEFQSVxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNBbXpIZWFkZXIoa2V5OiBzdHJpbmcpIHtcbiAgY29uc3QgdGVtcCA9IGtleS50b0xvd2VyQ2FzZSgpXG4gIHJldHVybiAoXG4gICAgdGVtcC5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSB8fFxuICAgIHRlbXAgPT09ICd4LWFtei1hY2wnIHx8XG4gICAgdGVtcC5zdGFydHNXaXRoKCd4LWFtei1zZXJ2ZXItc2lkZS1lbmNyeXB0aW9uLScpIHx8XG4gICAgdGVtcCA9PT0gJ3gtYW16LXNlcnZlci1zaWRlLWVuY3J5cHRpb24nXG4gIClcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgaXQgaXMgYSBzdXBwb3J0ZWQgSGVhZGVyXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N1cHBvcnRlZEhlYWRlcihrZXk6IHN0cmluZykge1xuICBjb25zdCBzdXBwb3J0ZWRfaGVhZGVycyA9IFtcbiAgICAnY29udGVudC10eXBlJyxcbiAgICAnY2FjaGUtY29udHJvbCcsXG4gICAgJ2NvbnRlbnQtZW5jb2RpbmcnLFxuICAgICdjb250ZW50LWRpc3Bvc2l0aW9uJyxcbiAgICAnY29udGVudC1sYW5ndWFnZScsXG4gICAgJ3gtYW16LXdlYnNpdGUtcmVkaXJlY3QtbG9jYXRpb24nLFxuICBdXG4gIHJldHVybiBzdXBwb3J0ZWRfaGVhZGVycy5pbmNsdWRlcyhrZXkudG9Mb3dlckNhc2UoKSlcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgaXQgaXMgYSBzdG9yYWdlIGhlYWRlclxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdG9yYWdlQ2xhc3NIZWFkZXIoa2V5OiBzdHJpbmcpIHtcbiAgcmV0dXJuIGtleS50b0xvd2VyQ2FzZSgpID09PSAneC1hbXotc3RvcmFnZS1jbGFzcydcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV4dHJhY3RNZXRhZGF0YShoZWFkZXJzOiBSZXNwb25zZUhlYWRlcikge1xuICByZXR1cm4gXy5tYXBLZXlzKFxuICAgIF8ucGlja0J5KGhlYWRlcnMsICh2YWx1ZSwga2V5KSA9PiBpc1N1cHBvcnRlZEhlYWRlcihrZXkpIHx8IGlzU3RvcmFnZUNsYXNzSGVhZGVyKGtleSkgfHwgaXNBbXpIZWFkZXIoa2V5KSksXG4gICAgKHZhbHVlLCBrZXkpID0+IHtcbiAgICAgIGNvbnN0IGxvd2VyID0ga2V5LnRvTG93ZXJDYXNlKClcbiAgICAgIGlmIChsb3dlci5zdGFydHNXaXRoKE1ldGFEYXRhSGVhZGVyUHJlZml4KSkge1xuICAgICAgICByZXR1cm4gbG93ZXIuc2xpY2UoTWV0YURhdGFIZWFkZXJQcmVmaXgubGVuZ3RoKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4ga2V5XG4gICAgfSxcbiAgKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0VmVyc2lvbklkKGhlYWRlcnM6IFJlc3BvbnNlSGVhZGVyID0ge30pIHtcbiAgcmV0dXJuIGhlYWRlcnNbJ3gtYW16LXZlcnNpb24taWQnXSB8fCBudWxsXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTb3VyY2VWZXJzaW9uSWQoaGVhZGVyczogUmVzcG9uc2VIZWFkZXIgPSB7fSkge1xuICByZXR1cm4gaGVhZGVyc1sneC1hbXotY29weS1zb3VyY2UtdmVyc2lvbi1pZCddIHx8IG51bGxcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRVRhZyhldGFnID0gJycpOiBzdHJpbmcge1xuICBjb25zdCByZXBsYWNlQ2hhcnM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgJ1wiJzogJycsXG4gICAgJyZxdW90Oyc6ICcnLFxuICAgICcmIzM0Oyc6ICcnLFxuICAgICcmUVVPVDsnOiAnJyxcbiAgICAnJiN4MDAwMjInOiAnJyxcbiAgfVxuICByZXR1cm4gZXRhZy5yZXBsYWNlKC9eKFwifCZxdW90O3wmIzM0Oyl8KFwifCZxdW90O3wmIzM0OykkL2csIChtKSA9PiByZXBsYWNlQ2hhcnNbbV0gYXMgc3RyaW5nKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9NZDUocGF5bG9hZDogQmluYXJ5KTogc3RyaW5nIHtcbiAgLy8gdXNlIHN0cmluZyBmcm9tIGJyb3dzZXIgYW5kIGJ1ZmZlciBmcm9tIG5vZGVqc1xuICAvLyBicm93c2VyIHN1cHBvcnQgaXMgdGVzdGVkIG9ubHkgYWdhaW5zdCBtaW5pbyBzZXJ2ZXJcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdtZDUnKS51cGRhdGUoQnVmZmVyLmZyb20ocGF5bG9hZCkpLmRpZ2VzdCgpLnRvU3RyaW5nKCdiYXNlNjQnKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdG9TaGEyNTYocGF5bG9hZDogQmluYXJ5KTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyeXB0by5jcmVhdGVIYXNoKCdzaGEyNTYnKS51cGRhdGUocGF5bG9hZCkuZGlnZXN0KCdoZXgnKVxufVxuXG4vKipcbiAqIHRvQXJyYXkgcmV0dXJucyBhIHNpbmdsZSBlbGVtZW50IGFycmF5IHdpdGggcGFyYW0gYmVpbmcgdGhlIGVsZW1lbnQsXG4gKiBpZiBwYXJhbSBpcyBqdXN0IGEgc3RyaW5nLCBhbmQgcmV0dXJucyAncGFyYW0nIGJhY2sgaWYgaXQgaXMgYW4gYXJyYXlcbiAqIFNvLCBpdCBtYWtlcyBzdXJlIHBhcmFtIGlzIGFsd2F5cyBhbiBhcnJheVxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9BcnJheTxUID0gdW5rbm93bj4ocGFyYW06IFQgfCBUW10pOiBBcnJheTxUPiB7XG4gIGlmICghQXJyYXkuaXNBcnJheShwYXJhbSkpIHtcbiAgICByZXR1cm4gW3BhcmFtXSBhcyBUW11cbiAgfVxuICByZXR1cm4gcGFyYW1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplT2JqZWN0S2V5KG9iamVjdE5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIC8vICsgc3ltYm9sIGNoYXJhY3RlcnMgYXJlIG5vdCBkZWNvZGVkIGFzIHNwYWNlcyBpbiBKUy4gc28gcmVwbGFjZSB0aGVtIGZpcnN0IGFuZCBkZWNvZGUgdG8gZ2V0IHRoZSBjb3JyZWN0IHJlc3VsdC5cbiAgY29uc3QgYXNTdHJOYW1lID0gKG9iamVjdE5hbWUgPyBvYmplY3ROYW1lLnRvU3RyaW5nKCkgOiAnJykucmVwbGFjZSgvXFwrL2csICcgJylcbiAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChhc1N0ck5hbWUpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZVNpemUoc2l6ZT86IHN0cmluZyk6IG51bWJlciB8IHVuZGVmaW5lZCB7XG4gIHJldHVybiBzaXplID8gTnVtYmVyLnBhcnNlSW50KHNpemUpIDogdW5kZWZpbmVkXG59XG5cbmV4cG9ydCBjb25zdCBQQVJUX0NPTlNUUkFJTlRTID0ge1xuICAvLyBhYnNNaW5QYXJ0U2l6ZSAtIGFic29sdXRlIG1pbmltdW0gcGFydCBzaXplICg1IE1pQilcbiAgQUJTX01JTl9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUlOX1BBUlRfU0laRSAtIG1pbmltdW0gcGFydCBzaXplIDE2TWlCIHBlciBvYmplY3QgYWZ0ZXIgd2hpY2hcbiAgTUlOX1BBUlRfU0laRTogMTAyNCAqIDEwMjQgKiAxNixcbiAgLy8gTUFYX1BBUlRTX0NPVU5UIC0gbWF4aW11bSBudW1iZXIgb2YgcGFydHMgZm9yIGEgc2luZ2xlIG11bHRpcGFydCBzZXNzaW9uLlxuICBNQVhfUEFSVFNfQ09VTlQ6IDEwMDAwLFxuICAvLyBNQVhfUEFSVF9TSVpFIC0gbWF4aW11bSBwYXJ0IHNpemUgNUdpQiBmb3IgYSBzaW5nbGUgbXVsdGlwYXJ0IHVwbG9hZFxuICAvLyBvcGVyYXRpb24uXG4gIE1BWF9QQVJUX1NJWkU6IDEwMjQgKiAxMDI0ICogMTAyNCAqIDUsXG4gIC8vIE1BWF9TSU5HTEVfUFVUX09CSkVDVF9TSVpFIC0gbWF4aW11bSBzaXplIDVHaUIgb2Ygb2JqZWN0IHBlciBQVVRcbiAgLy8gb3BlcmF0aW9uLlxuICBNQVhfU0lOR0xFX1BVVF9PQkpFQ1RfU0laRTogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbiAgLy8gTUFYX01VTFRJUEFSVF9QVVRfT0JKRUNUX1NJWkUgLSBtYXhpbXVtIHNpemUgNVRpQiBvZiBvYmplY3QgZm9yXG4gIC8vIE11bHRpcGFydCBvcGVyYXRpb24uXG4gIE1BWF9NVUxUSVBBUlRfUFVUX09CSkVDVF9TSVpFOiAxMDI0ICogMTAyNCAqIDEwMjQgKiAxMDI0ICogNSxcbn1cblxuY29uc3QgR0VORVJJQ19TU0VfSEVBREVSID0gJ1gtQW16LVNlcnZlci1TaWRlLUVuY3J5cHRpb24nXG5jb25zdCBTU0VDX0NVU1RPTUVSX0FMR09SSVRITSA9IGAke0dFTkVSSUNfU1NFX0hFQURFUn0tQ3VzdG9tZXItQWxnb3JpdGhtYFxuY29uc3QgU1NFQ19DVVNUT01FUl9LRVkgPSBgJHtHRU5FUklDX1NTRV9IRUFERVJ9LUN1c3RvbWVyLUtleWBcbmNvbnN0IFNTRUNfQ1VTVE9NRVJfS0VZX01ENSA9IGAke0dFTkVSSUNfU1NFX0hFQURFUn0tQ3VzdG9tZXItS2V5LU1ENWBcblxuY29uc3QgRU5DUllQVElPTl9IRUFERVJTID0ge1xuICAvLyBzc2VHZW5lcmljSGVhZGVyIGlzIHRoZSBBV1MgU1NFIGhlYWRlciB1c2VkIGZvciBTU0UtUzMgYW5kIFNTRS1LTVMuXG4gIHNzZUdlbmVyaWNIZWFkZXI6IEdFTkVSSUNfU1NFX0hFQURFUixcbiAgLy8gc3NlS21zS2V5SUQgaXMgdGhlIEFXUyBTU0UtS01TIGtleSBpZC5cbiAgc3NlS21zS2V5SUQ6IEdFTkVSSUNfU1NFX0hFQURFUiArICctQXdzLUttcy1LZXktSWQnLFxuICBzc2VDQ3VzdG9tZXJBbGdvcml0aG06IFNTRUNfQ1VTVE9NRVJfQUxHT1JJVEhNLFxuICBzc2VDQ3VzdG9tZXJLZXk6IFNTRUNfQ1VTVE9NRVJfS0VZLFxuICBzc2VDQ3VzdG9tZXJLZXlNZDU6IFNTRUNfQ1VTVE9NRVJfS0VZX01ENVxufSBhcyBjb25zdFxuXG4vKipcbiAqIFJldHVybiBFbmNyeXB0aW9uIGhlYWRlcnNcbiAqIEBwYXJhbSBlbmNDb25maWdcbiAqIEByZXR1cm5zIGFuIG9iamVjdCB3aXRoIGtleSB2YWx1ZSBwYWlycyB0aGF0IGNhbiBiZSB1c2VkIGluIGhlYWRlcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBnZXRFbmNyeXB0aW9uSGVhZGVycyhlbmNDb25maWc6IEVuY3J5cHRpb24pOiBSZXF1ZXN0SGVhZGVycyB7XG4gIGNvbnN0IGVuY1R5cGUgPSBlbmNDb25maWcudHlwZVxuXG4gIGlmICghaXNFbXB0eShlbmNUeXBlKSkge1xuICAgIGlmIChlbmNUeXBlID09PSBFTkNSWVBUSU9OX1RZUEVTLlNTRUMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06ICdBRVMyNTYnLFxuICAgICAgICBbRU5DUllQVElPTl9IRUFERVJTLnNzZUNDdXN0b21lckFsZ29yaXRobV06IGVuY0NvbmZpZy5TU0VDdXN0b21lckFsZ29yaXRobSxcbiAgICAgICAgW0VOQ1JZUFRJT05fSEVBREVSUy5zc2VDQ3VzdG9tZXJLZXldOiBlbmNDb25maWcuU1NFQ3VzdG9tZXJLZXksXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlQ0N1c3RvbWVyS2V5TWQ1XTogZW5jQ29uZmlnLlNTRUN1c3RvbWVyS2V5TUQ1LFxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoZW5jVHlwZSA9PT0gRU5DUllQVElPTl9UWVBFUy5LTVMpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlR2VuZXJpY0hlYWRlcl06IGVuY0NvbmZpZy5TU0VBbGdvcml0aG0sXG4gICAgICAgIFtFTkNSWVBUSU9OX0hFQURFUlMuc3NlS21zS2V5SURdOiBlbmNDb25maWcuS01TTWFzdGVyS2V5SUQsXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHt9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBwYXJ0c1JlcXVpcmVkKHNpemU6IG51bWJlcik6IG51bWJlciB7XG4gIGNvbnN0IG1heFBhcnRTaXplID0gUEFSVF9DT05TVFJBSU5UUy5NQVhfTVVMVElQQVJUX1BVVF9PQkpFQ1RfU0laRSAvIChQQVJUX0NPTlNUUkFJTlRTLk1BWF9QQVJUU19DT1VOVCAtIDEpXG4gIGxldCByZXF1aXJlZFBhcnRTaXplID0gc2l6ZSAvIG1heFBhcnRTaXplXG4gIGlmIChzaXplICUgbWF4UGFydFNpemUgPiAwKSB7XG4gICAgcmVxdWlyZWRQYXJ0U2l6ZSsrXG4gIH1cbiAgcmVxdWlyZWRQYXJ0U2l6ZSA9IE1hdGgudHJ1bmMocmVxdWlyZWRQYXJ0U2l6ZSlcbiAgcmV0dXJuIHJlcXVpcmVkUGFydFNpemVcbn1cblxuLyoqXG4gKiBjYWxjdWxhdGVFdmVuU3BsaXRzIC0gY29tcHV0ZXMgc3BsaXRzIGZvciBhIHNvdXJjZSBhbmQgcmV0dXJuc1xuICogc3RhcnQgYW5kIGVuZCBpbmRleCBzbGljZXMuIFNwbGl0cyBoYXBwZW4gZXZlbmx5IHRvIGJlIHN1cmUgdGhhdCBub1xuICogcGFydCBpcyBsZXNzIHRoYW4gNU1pQiwgYXMgdGhhdCBjb3VsZCBmYWlsIHRoZSBtdWx0aXBhcnQgcmVxdWVzdCBpZlxuICogaXQgaXMgbm90IHRoZSBsYXN0IHBhcnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjYWxjdWxhdGVFdmVuU3BsaXRzPFQgZXh0ZW5kcyB7IFN0YXJ0PzogbnVtYmVyIH0+KFxuICBzaXplOiBudW1iZXIsXG4gIG9iakluZm86IFQsXG4pOiB7XG4gIHN0YXJ0SW5kZXg6IG51bWJlcltdXG4gIG9iakluZm86IFRcbiAgZW5kSW5kZXg6IG51bWJlcltdXG59IHwgbnVsbCB7XG4gIGlmIChzaXplID09PSAwKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuICBjb25zdCByZXFQYXJ0cyA9IHBhcnRzUmVxdWlyZWQoc2l6ZSlcbiAgY29uc3Qgc3RhcnRJbmRleFBhcnRzOiBudW1iZXJbXSA9IFtdXG4gIGNvbnN0IGVuZEluZGV4UGFydHM6IG51bWJlcltdID0gW11cblxuICBsZXQgc3RhcnQgPSBvYmpJbmZvLlN0YXJ0XG4gIGlmIChpc0VtcHR5KHN0YXJ0KSB8fCBzdGFydCA9PT0gLTEpIHtcbiAgICBzdGFydCA9IDBcbiAgfVxuICBjb25zdCBkaXZpc29yVmFsdWUgPSBNYXRoLnRydW5jKHNpemUgLyByZXFQYXJ0cylcblxuICBjb25zdCByZW1pbmRlclZhbHVlID0gc2l6ZSAlIHJlcVBhcnRzXG5cbiAgbGV0IG5leHRTdGFydCA9IHN0YXJ0XG5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCByZXFQYXJ0czsgaSsrKSB7XG4gICAgbGV0IGN1clBhcnRTaXplID0gZGl2aXNvclZhbHVlXG4gICAgaWYgKGkgPCByZW1pbmRlclZhbHVlKSB7XG4gICAgICBjdXJQYXJ0U2l6ZSsrXG4gICAgfVxuXG4gICAgY29uc3QgY3VycmVudFN0YXJ0ID0gbmV4dFN0YXJ0XG4gICAgY29uc3QgY3VycmVudEVuZCA9IGN1cnJlbnRTdGFydCArIGN1clBhcnRTaXplIC0gMVxuICAgIG5leHRTdGFydCA9IGN1cnJlbnRFbmQgKyAxXG5cbiAgICBzdGFydEluZGV4UGFydHMucHVzaChjdXJyZW50U3RhcnQpXG4gICAgZW5kSW5kZXhQYXJ0cy5wdXNoKGN1cnJlbnRFbmQpXG4gIH1cblxuICByZXR1cm4geyBzdGFydEluZGV4OiBzdGFydEluZGV4UGFydHMsIGVuZEluZGV4OiBlbmRJbmRleFBhcnRzLCBvYmpJbmZvOiBvYmpJbmZvIH1cbn1cblxuY29uc3QgZnhwID0gbmV3IFhNTFBhcnNlcigpXG5cbi8vIGVzbGludC1kaXNhYmxlLW5leHQtbGluZSBAdHlwZXNjcmlwdC1lc2xpbnQvbm8tZXhwbGljaXQtYW55XG5leHBvcnQgZnVuY3Rpb24gcGFyc2VYbWwoeG1sOiBzdHJpbmcpOiBhbnkge1xuICBjb25zdCByZXN1bHQgPSBmeHAucGFyc2UoeG1sKVxuICBpZiAocmVzdWx0LkVycm9yKSB7XG4gICAgdGhyb3cgcmVzdWx0LkVycm9yXG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogZ2V0IGNvbnRlbnQgc2l6ZSBvZiBvYmplY3QgY29udGVudCB0byB1cGxvYWRcbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdldENvbnRlbnRMZW5ndGgoczogc3RyZWFtLlJlYWRhYmxlIHwgQnVmZmVyIHwgc3RyaW5nKTogUHJvbWlzZTxudW1iZXIgfCBudWxsPiB7XG4gIC8vIHVzZSBsZW5ndGggcHJvcGVydHkgb2Ygc3RyaW5nIHwgQnVmZmVyXG4gIGlmICh0eXBlb2YgcyA9PT0gJ3N0cmluZycgfHwgQnVmZmVyLmlzQnVmZmVyKHMpKSB7XG4gICAgcmV0dXJuIHMubGVuZ3RoXG4gIH1cblxuICAvLyBwcm9wZXJ0eSBvZiBgZnMuUmVhZFN0cmVhbWBcbiAgY29uc3QgZmlsZVBhdGggPSAocyBhcyB1bmtub3duIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+KS5wYXRoIGFzIHN0cmluZyB8IHVuZGVmaW5lZFxuICBpZiAoZmlsZVBhdGggJiYgdHlwZW9mIGZpbGVQYXRoID09PSAnc3RyaW5nJykge1xuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3AubHN0YXQoZmlsZVBhdGgpXG4gICAgcmV0dXJuIHN0YXQuc2l6ZVxuICB9XG5cbiAgLy8gcHJvcGVydHkgb2YgYGZzLlJlYWRTdHJlYW1gXG4gIGNvbnN0IGZkID0gKHMgYXMgdW5rbm93biBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuZmQgYXMgbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZFxuICBpZiAoZmQgJiYgdHlwZW9mIGZkID09PSAnbnVtYmVyJykge1xuICAgIGNvbnN0IHN0YXQgPSBhd2FpdCBmc3RhdChmZClcbiAgICByZXR1cm4gc3RhdC5zaXplXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsT0FBTyxLQUFLQSxNQUFNO0FBQ2xCLE9BQU8sS0FBS0MsTUFBTTtBQUVsQixTQUFTQyxTQUFTLFFBQVEsaUJBQWlCO0FBQzNDLE9BQU9DLE1BQU0sTUFBTSxXQUFXO0FBQzlCLE9BQU9DLENBQUMsTUFBTSxRQUFRO0FBQ3RCLE9BQU8sS0FBS0MsSUFBSSxNQUFNLFlBQVk7QUFFbEMsU0FBU0MsR0FBRyxFQUFFQyxLQUFLLFFBQVEsYUFBWTtBQUV2QyxTQUFTQyxnQkFBZ0IsUUFBUSxZQUFXO0FBRTVDLE1BQU1DLG9CQUFvQixHQUFHLGFBQWE7QUFFMUMsT0FBTyxTQUFTQyxVQUFVQSxDQUFDQyxHQUFXLEVBQUVDLFlBQXFCLEVBQUU7RUFDN0QsSUFBSUMsU0FBUyxHQUFHLEVBQUU7RUFDbEIsSUFB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