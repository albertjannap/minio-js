"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getBucketNotificationTransformer = getBucketNotificationTransformer;
exports.getConcater = getConcater;
exports.getHashSummer = getHashSummer;
exports.getListObjectsTransformer = getListObjectsTransformer;
exports.getListObjectsV2Transformer = getListObjectsV2Transformer;
exports.getListObjectsV2WithMetadataTransformer = getListObjectsV2WithMetadataTransformer;
var Crypto = _interopRequireWildcard(require("crypto"), true);
var _through = require("through2");
var _helper = require("./internal/helper.js");
var xmlParsers = _interopRequireWildcard(require("./xml-parsers.js"), true);
function _getRequireWildcardCache(nodeInterop) { if (typeof WeakMap !== "function") return null; var cacheBabelInterop = new WeakMap(); var cacheNodeInterop = new WeakMap(); return (_getRequireWildcardCache = function (nodeInterop) { return nodeInterop ? cacheNodeInterop : cacheBabelInterop; })(nodeInterop); }
function _interopRequireWildcard(obj, nodeInterop) { if (!nodeInterop && obj && obj.__esModule) { return obj; } if (obj === null || typeof obj !== "object" && typeof obj !== "function") { return { default: obj }; } var cache = _getRequireWildcardCache(nodeInterop); if (cache && cache.has(obj)) { return cache.get(obj); } var newObj = {}; var hasPropertyDescriptor = Object.defineProperty && Object.getOwnPropertyDescriptor; for (var key in obj) { if (key !== "default" && Object.prototype.hasOwnProperty.call(obj, key)) { var desc = hasPropertyDescriptor ? Object.getOwnPropertyDescriptor(obj, key) : null; if (desc && (desc.get || desc.set)) { Object.defineProperty(newObj, key, desc); } else { newObj[key] = obj[key]; } } } newObj.default = obj; if (cache) { cache.set(obj, newObj); } return newObj; }
/*
 * MinIO Javascript Library for Amazon S3 Compatible Cloud Storage, (C) 2015, 2016 MinIO, Inc.
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

// getConcater returns a stream that concatenates the input and emits
// the concatenated output when 'end' has reached. If an optional
// parser function is passed upon reaching the 'end' of the stream,
// `parser(concatenated_data)` will be emitted.
function getConcater(parser, emitError) {
  var objectMode = false;
  var bufs = [];
  if (parser && !(0, _helper.isFunction)(parser)) {
    throw new TypeError('parser should be of type "function"');
  }
  if (parser) {
    objectMode = true;
  }
  return _through({
    objectMode
  }, function (chunk, enc, cb) {
    bufs.push(chunk);
    cb();
  }, function (cb) {
    if (emitError) {
      cb(parser(Buffer.concat(bufs).toString()));
      // cb(e) would mean we have to emit 'end' by explicitly calling this.push(null)
      this.push(null);
      return;
    }
    if (bufs.length) {
      if (parser) {
        this.push(parser(Buffer.concat(bufs).toString()));
      } else {
        this.push(Buffer.concat(bufs));
      }
    }
    cb();
  });
}

// A through stream that calculates md5sum and sha256sum
function getHashSummer(enableSHA256) {
  var md5 = Crypto.createHash('md5');
  var sha256 = Crypto.createHash('sha256');
  return _through.obj(function (chunk, enc, cb) {
    if (enableSHA256) {
      sha256.update(chunk);
    } else {
      md5.update(chunk);
    }
    cb();
  }, function (cb) {
    var md5sum = '';
    var sha256sum = '';
    if (enableSHA256) {
      sha256sum = sha256.digest('hex');
    } else {
      md5sum = md5.digest('base64');
    }
    var hashData = {
      md5sum,
      sha256sum
    };
    this.push(hashData);
    this.push(null);
    cb();
  });
}

// Following functions return a stream object that parses XML
// and emits suitable Javascript objects.

// Parses listObjects response.
function getListObjectsTransformer() {
  return getConcater(xmlParsers.parseListObjects);
}

// Parses listObjects response.
function getListObjectsV2Transformer() {
  return getConcater(xmlParsers.parseListObjectsV2);
}

// Parses listObjects with metadata response.
function getListObjectsV2WithMetadataTransformer() {
  return getConcater(xmlParsers.parseListObjectsV2WithMetadata);
}

// Parses GET/SET BucketNotification response
function getBucketNotificationTransformer() {
  return getConcater(xmlParsers.parseBucketNotification);
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJDcnlwdG8iLCJfaW50ZXJvcFJlcXVpcmVXaWxkY2FyZCIsInJlcXVpcmUiLCJfdGhyb3VnaCIsIl9oZWxwZXIiLCJ4bWxQYXJzZXJzIiwiX2dldFJlcXVpcmVXaWxkY2FyZENhY2hlIiwibm9kZUludGVyb3AiLCJXZWFrTWFwIiwiY2FjaGVCYWJlbEludGVyb3AiLCJjYWNoZU5vZGVJbnRlcm9wIiwib2JqIiwiX19lc01vZHVsZSIsImRlZmF1bHQiLCJjYWNoZSIsImhhcyIsImdldCIsIm5ld09iaiIsImhhc1Byb3BlcnR5RGVzY3JpcHRvciIsIk9iamVjdCIsImRlZmluZVByb3BlcnR5IiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwia2V5IiwicHJvdG90eXBlIiwiaGFzT3duUHJvcGVydHkiLCJjYWxsIiwiZGVzYyIsInNldCIsImdldENvbmNhdGVyIiwicGFyc2VyIiwiZW1pdEVycm9yIiwib2JqZWN0TW9kZSIsImJ1ZnMiLCJpc0Z1bmN0aW9uIiwiVHlwZUVycm9yIiwiVGhyb3VnaDIiLCJjaHVuayIsImVuYyIsImNiIiwicHVzaCIsIkJ1ZmZlciIsImNvbmNhdCIsInRvU3RyaW5nIiwibGVuZ3RoIiwiZ2V0SGFzaFN1bW1lciIsImVuYWJsZVNIQTI1NiIsIm1kNSIsImNyZWF0ZUhhc2giLCJzaGEyNTYiLCJ1cGRhdGUiLCJtZDVzdW0iLCJzaGEyNTZzdW0iLCJkaWdlc3QiLCJoYXNoRGF0YSIsImdldExpc3RPYmplY3RzVHJhbnNmb3JtZXIiLCJwYXJzZUxpc3RPYmplY3RzIiwiZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyIiwicGFyc2VMaXN0T2JqZWN0c1YyIiwiZ2V0TGlzdE9iamVjdHNWMldpdGhNZXRhZGF0YVRyYW5zZm9ybWVyIiwicGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhIiwiZ2V0QnVja2V0Tm90aWZpY2F0aW9uVHJhbnNmb3JtZXIiLCJwYXJzZUJ1Y2tldE5vdGlmaWNhdGlvbiJdLCJzb3VyY2VzIjpbInRyYW5zZm9ybWVycy5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSwgMjAxNiBNaW5JTywgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5pbXBvcnQgKiBhcyBDcnlwdG8gZnJvbSAnbm9kZTpjcnlwdG8nXG5cbmltcG9ydCBUaHJvdWdoMiBmcm9tICd0aHJvdWdoMidcblxuaW1wb3J0IHsgaXNGdW5jdGlvbiB9IGZyb20gJy4vaW50ZXJuYWwvaGVscGVyLnRzJ1xuaW1wb3J0ICogYXMgeG1sUGFyc2VycyBmcm9tICcuL3htbC1wYXJzZXJzLmpzJ1xuXG4vLyBnZXRDb25jYXRlciByZXR1cm5zIGEgc3RyZWFtIHRoYXQgY29uY2F0ZW5hdGVzIHRoZSBpbnB1dCBhbmQgZW1pdHNcbi8vIHRoZSBjb25jYXRlbmF0ZWQgb3V0cHV0IHdoZW4gJ2VuZCcgaGFzIHJlYWNoZWQuIElmIGFuIG9wdGlvbmFsXG4vLyBwYXJzZXIgZnVuY3Rpb24gaXMgcGFzc2VkIHVwb24gcmVhY2hpbmcgdGhlICdlbmQnIG9mIHRoZSBzdHJlYW0sXG4vLyBgcGFyc2VyKGNvbmNhdGVuYXRlZF9kYXRhKWAgd2lsbCBiZSBlbWl0dGVkLlxuZXhwb3J0IGZ1bmN0aW9uIGdldENvbmNhdGVyKHBhcnNlciwgZW1pdEVycm9yKSB7XG4gIHZhciBvYmplY3RNb2RlID0gZmFsc2VcbiAgdmFyIGJ1ZnMgPSBbXVxuXG4gIGlmIChwYXJzZXIgJiYgIWlzRnVuY3Rpb24ocGFyc2VyKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ3BhcnNlciBzaG91bGQgYmUgb2YgdHlwZSBcImZ1bmN0aW9uXCInKVxuICB9XG5cbiAgaWYgKHBhcnNlcikge1xuICAgIG9iamVjdE1vZGUgPSB0cnVlXG4gIH1cblxuICByZXR1cm4gVGhyb3VnaDIoXG4gICAgeyBvYmplY3RNb2RlIH0sXG4gICAgZnVuY3Rpb24gKGNodW5rLCBlbmMsIGNiKSB7XG4gICAgICBidWZzLnB1c2goY2h1bmspXG4gICAgICBjYigpXG4gICAgfSxcbiAgICBmdW5jdGlvbiAoY2IpIHtcbiAgICAgIGlmIChlbWl0RXJyb3IpIHtcbiAgICAgICAgY2IocGFyc2VyKEJ1ZmZlci5jb25jYXQoYnVmcykudG9TdHJpbmcoKSkpXG4gICAgICAgIC8vIGNiKGUpIHdvdWxkIG1lYW4gd2UgaGF2ZSB0byBlbWl0ICdlbmQnIGJ5IGV4cGxpY2l0bHkgY2FsbGluZyB0aGlzLnB1c2gobnVsbClcbiAgICAgICAgdGhpcy5wdXNoKG51bGwpXG4gICAgICAgIHJldHVyblxuICAgICAgfVxuICAgICAgaWYgKGJ1ZnMubGVuZ3RoKSB7XG4gICAgICAgIGlmIChwYXJzZXIpIHtcbiAgICAgICAgICB0aGlzLnB1c2gocGFyc2VyKEJ1ZmZlci5jb25jYXQoYnVmcykudG9TdHJpbmcoKSkpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy5wdXNoKEJ1ZmZlci5jb25jYXQoYnVmcykpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGNiKClcbiAgICB9LFxuICApXG59XG5cbi8vIEEgdGhyb3VnaCBzdHJlYW0gdGhhdCBjYWxjdWxhdGVzIG1kNXN1bSBhbmQgc2hhMjU2c3VtXG5leHBvcnQgZnVuY3Rpb24gZ2V0SGFzaFN1bW1lcihlbmFibGVTSEEyNTYpIHtcbiAgdmFyIG1kNSA9IENyeXB0by5jcmVhdGVIYXNoKCdtZDUnKVxuICB2YXIgc2hhMjU2ID0gQ3J5cHRvLmNyZWF0ZUhhc2goJ3NoYTI1NicpXG5cbiAgcmV0dXJuIFRocm91Z2gyLm9iaihcbiAgICBmdW5jdGlvbiAoY2h1bmssIGVuYywgY2IpIHtcbiAgICAgIGlmIChlbmFibGVTSEEyNTYpIHtcbiAgICAgICAgc2hhMjU2LnVwZGF0ZShjaHVuaylcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1kNS51cGRhdGUoY2h1bmspXG4gICAgICB9XG4gICAgICBjYigpXG4gICAgfSxcbiAgICBmdW5jdGlvbiAoY2IpIHtcbiAgICAgIHZhciBtZDVzdW0gPSAnJ1xuICAgICAgdmFyIHNoYTI1NnN1bSA9ICcnXG4gICAgICBpZiAoZW5hYmxlU0hBMjU2KSB7XG4gICAgICAgIHNoYTI1NnN1bSA9IHNoYTI1Ni5kaWdlc3QoJ2hleCcpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtZDVzdW0gPSBtZDUuZGlnZXN0KCdiYXNlNjQnKVxuICAgICAgfVxuICAgICAgdmFyIGhhc2hEYXRhID0geyBtZDVzdW0sIHNoYTI1NnN1bSB9XG4gICAgICB0aGlzLnB1c2goaGFzaERhdGEpXG4gICAgICB0aGlzLnB1c2gobnVsbClcbiAgICAgIGNiKClcbiAgICB9LFxuICApXG59XG5cbi8vIEZvbGxvd2luZyBmdW5jdGlvbnMgcmV0dXJuIGEgc3RyZWFtIG9iamVjdCB0aGF0IHBhcnNlcyBYTUxcbi8vIGFuZCBlbWl0cyBzdWl0YWJsZSBKYXZhc2NyaXB0IG9iamVjdHMuXG5cbi8vIFBhcnNlcyBsaXN0T2JqZWN0cyByZXNwb25zZS5cbmV4cG9ydCBmdW5jdGlvbiBnZXRMaXN0T2JqZWN0c1RyYW5zZm9ybWVyKCkge1xuICByZXR1cm4gZ2V0Q29uY2F0ZXIoeG1sUGFyc2Vycy5wYXJzZUxpc3RPYmplY3RzKVxufVxuXG4vLyBQYXJzZXMgbGlzdE9iamVjdHMgcmVzcG9uc2UuXG5leHBvcnQgZnVuY3Rpb24gZ2V0TGlzdE9iamVjdHNWMlRyYW5zZm9ybWVyKCkge1xuICByZXR1cm4gZ2V0Q29uY2F0ZXIoeG1sUGFyc2Vycy5wYXJzZUxpc3RPYmplY3RzVjIpXG59XG5cbi8vIFBhcnNlcyBsaXN0T2JqZWN0cyB3aXRoIG1ldGFkYXRhIHJlc3BvbnNlLlxuZXhwb3J0IGZ1bmN0aW9uIGdldExpc3RPYmplY3RzVjJXaXRoTWV0YWRhdGFUcmFuc2Zvcm1lcigpIHtcbiAgcmV0dXJuIGdldENvbmNhdGVyKHhtbFBhcnNlcnMucGFyc2VMaXN0T2JqZWN0c1YyV2l0aE1ldGFkYXRhKVxufVxuXG4vLyBQYXJzZXMgR0VUL1NFVCBCdWNrZXROb3RpZmljYXRpb24gcmVzcG9uc2VcbmV4cG9ydCBmdW5jdGlvbiBnZXRCdWNrZXROb3RpZmljYXRpb25UcmFuc2Zvcm1lcigpIHtcbiAgcmV0dXJuIGdldENvbmNhdGVyKHhtbFBhcnNlcnMucGFyc2VCdWNrZXROb3RpZmljYXRpb24pXG59XG4iXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7O0FBZ0JBLElBQUFBLE1BQUEsR0FBQUMsdUJBQUEsQ0FBQUMsT0FBQTtBQUVBLElBQUFDLFFBQUEsR0FBQUQsT0FBQTtBQUVBLElBQUFFLE9BQUEsR0FBQUYsT0FBQTtBQUNBLElBQUFHLFVBQUEsR0FBQUosdUJBQUEsQ0FBQUMsT0FBQTtBQUE4QyxTQUFBSSx5QkFBQUMsV0FBQSxlQUFBQyxPQUFBLGtDQUFBQyxp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