"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getS3Endpoint = getS3Endpoint;
var _helper = require("./helper.js");
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

// List of currently supported endpoints.
const awsS3Endpoint = {
  'us-east-1': 's3.amazonaws.com',
  'us-east-2': 's3-us-east-2.amazonaws.com',
  'us-west-1': 's3-us-west-1.amazonaws.com',
  'us-west-2': 's3-us-west-2.amazonaws.com',
  'ca-central-1': 's3.ca-central-1.amazonaws.com',
  'eu-west-1': 's3-eu-west-1.amazonaws.com',
  'eu-west-2': 's3-eu-west-2.amazonaws.com',
  'sa-east-1': 's3-sa-east-1.amazonaws.com',
  'eu-central-1': 's3-eu-central-1.amazonaws.com',
  'ap-south-1': 's3-ap-south-1.amazonaws.com',
  'ap-southeast-1': 's3-ap-southeast-1.amazonaws.com',
  'ap-southeast-2': 's3-ap-southeast-2.amazonaws.com',
  'ap-southeast-3': 's3-ap-southeast-3.amazonaws.com',
  'ap-northeast-1': 's3-ap-northeast-1.amazonaws.com',
  'cn-north-1': 's3.cn-north-1.amazonaws.com.cn',
  'ap-east-1': 's3.ap-east-1.amazonaws.com',
  'eu-north-1': 's3.eu-north-1.amazonaws.com'
  // Add new endpoints here.
};

// getS3Endpoint get relevant endpoint for the region.
function getS3Endpoint(region) {
  if (!(0, _helper.isString)(region)) {
    throw new TypeError(`Invalid region: ${region}`);
  }
  const endpoint = awsS3Endpoint[region];
  if (endpoint) {
    return endpoint;
  }
  return 's3.amazonaws.com';
}
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJfaGVscGVyIiwicmVxdWlyZSIsImF3c1MzRW5kcG9pbnQiLCJnZXRTM0VuZHBvaW50IiwicmVnaW9uIiwiaXNTdHJpbmciLCJUeXBlRXJyb3IiLCJlbmRwb2ludCJdLCJzb3VyY2VzIjpbInMzLWVuZHBvaW50cy50cyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICogTWluSU8gSmF2YXNjcmlwdCBMaWJyYXJ5IGZvciBBbWF6b24gUzMgQ29tcGF0aWJsZSBDbG91ZCBTdG9yYWdlLCAoQykgMjAxNSwgMjAxNiBNaW5JTywgSW5jLlxuICpcbiAqIExpY2Vuc2VkIHVuZGVyIHRoZSBBcGFjaGUgTGljZW5zZSwgVmVyc2lvbiAyLjAgKHRoZSBcIkxpY2Vuc2VcIik7XG4gKiB5b3UgbWF5IG5vdCB1c2UgdGhpcyBmaWxlIGV4Y2VwdCBpbiBjb21wbGlhbmNlIHdpdGggdGhlIExpY2Vuc2UuXG4gKiBZb3UgbWF5IG9idGFpbiBhIGNvcHkgb2YgdGhlIExpY2Vuc2UgYXRcbiAqXG4gKiAgICAgaHR0cDovL3d3dy5hcGFjaGUub3JnL2xpY2Vuc2VzL0xJQ0VOU0UtMi4wXG4gKlxuICogVW5sZXNzIHJlcXVpcmVkIGJ5IGFwcGxpY2FibGUgbGF3IG9yIGFncmVlZCB0byBpbiB3cml0aW5nLCBzb2Z0d2FyZVxuICogZGlzdHJpYnV0ZWQgdW5kZXIgdGhlIExpY2Vuc2UgaXMgZGlzdHJpYnV0ZWQgb24gYW4gXCJBUyBJU1wiIEJBU0lTLFxuICogV0lUSE9VVCBXQVJSQU5USUVTIE9SIENPTkRJVElPTlMgT0YgQU5ZIEtJTkQsIGVpdGhlciBleHByZXNzIG9yIGltcGxpZWQuXG4gKiBTZWUgdGhlIExpY2Vuc2UgZm9yIHRoZSBzcGVjaWZpYyBsYW5ndWFnZSBnb3Zlcm5pbmcgcGVybWlzc2lvbnMgYW5kXG4gKiBsaW1pdGF0aW9ucyB1bmRlciB0aGUgTGljZW5zZS5cbiAqL1xuXG5pbXBvcnQgeyBpc1N0cmluZyB9IGZyb20gJy4vaGVscGVyLnRzJ1xuXG4vLyBMaXN0IG9mIGN1cnJlbnRseSBzdXBwb3J0ZWQgZW5kcG9pbnRzLlxuY29uc3QgYXdzUzNFbmRwb2ludCA9IHtcbiAgJ3VzLWVhc3QtMSc6ICdzMy5hbWF6b25hd3MuY29tJyxcbiAgJ3VzLWVhc3QtMic6ICdzMy11cy1lYXN0LTIuYW1hem9uYXdzLmNvbScsXG4gICd1cy13ZXN0LTEnOiAnczMtdXMtd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAndXMtd2VzdC0yJzogJ3MzLXVzLXdlc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2NhLWNlbnRyYWwtMSc6ICdzMy5jYS1jZW50cmFsLTEuYW1hem9uYXdzLmNvbScsXG4gICdldS13ZXN0LTEnOiAnczMtZXUtd2VzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnZXUtd2VzdC0yJzogJ3MzLWV1LXdlc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ3NhLWVhc3QtMSc6ICdzMy1zYS1lYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdldS1jZW50cmFsLTEnOiAnczMtZXUtY2VudHJhbC0xLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGgtMSc6ICdzMy1hcC1zb3V0aC0xLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtc291dGhlYXN0LTEnOiAnczMtYXAtc291dGhlYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdhcC1zb3V0aGVhc3QtMic6ICdzMy1hcC1zb3V0aGVhc3QtMi5hbWF6b25hd3MuY29tJyxcbiAgJ2FwLXNvdXRoZWFzdC0zJzogJ3MzLWFwLXNvdXRoZWFzdC0zLmFtYXpvbmF3cy5jb20nLFxuICAnYXAtbm9ydGhlYXN0LTEnOiAnczMtYXAtbm9ydGhlYXN0LTEuYW1hem9uYXdzLmNvbScsXG4gICdjbi1ub3J0aC0xJzogJ3MzLmNuLW5vcnRoLTEuYW1hem9uYXdzLmNvbS5jbicsXG4gICdhcC1lYXN0LTEnOiAnczMuYXAtZWFzdC0xLmFtYXpvbmF3cy5jb20nLFxuICAnZXUtbm9ydGgtMSc6ICdzMy5ldS1ub3J0aC0xLmFtYXpvbmF3cy5jb20nLFxuICAvLyBBZGQgbmV3IGVuZHBvaW50cyBoZXJlLlxufVxuXG5leHBvcnQgdHlwZSBSZWdpb24gPSBrZXlvZiB0eXBlb2YgYXdzUzNFbmRwb2ludCB8IHN0cmluZ1xuXG4vLyBnZXRTM0VuZHBvaW50IGdldCByZWxldmFudCBlbmRwb2ludCBmb3IgdGhlIHJlZ2lvbi5cbmV4cG9ydCBmdW5jdGlvbiBnZXRTM0VuZHBvaW50KHJlZ2lvbjogUmVnaW9uKTogc3RyaW5nIHtcbiAgaWYgKCFpc1N0cmluZyhyZWdpb24pKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcihgSW52YWxpZCByZWdpb246ICR7cmVnaW9ufWApXG4gIH1cblxuICBjb25zdCBlbmRwb2ludCA9IChhd3NTM0VuZHBvaW50IGFzIFJlY29yZDxzdHJpbmcsIHN0cmluZz4pW3JlZ2lvbl1cbiAgaWYgKGVuZHBvaW50KSB7XG4gICAgcmV0dXJuIGVuZHBvaW50XG4gIH1cbiAgcmV0dXJuICdzMy5hbWF6b25hd3MuY29tJ1xufVxuIl0sIm1hcHBpbmdzIjoiOzs7Ozs7QUFnQkEsSUFBQUEsT0FBQSxHQUFBQyxPQUFBO0FBaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFJQTtBQUNBLE1BQU1DLGFBQWEsR0FBRztFQUNwQixXQUFXLEVBQUUsa0JBQWtCO0VBQy9CLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLGNBQWMsRUFBRSwrQkFBK0I7RUFDL0MsV0FBVyxFQUFFLDRCQUE0QjtFQUN6QyxXQUFXLEVBQUUsNEJBQTRCO0VBQ3pDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsY0FBYyxFQUFFLCtCQUErQjtFQUMvQyxZQUFZLEVBQUUsNkJBQTZCO0VBQzNDLGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxnQkFBZ0IsRUFBRSxpQ0FBaUM7RUFDbkQsZ0JBQWdCLEVBQUUsaUNBQWlDO0VBQ25ELGdCQUFnQixFQUFFLGlDQUFpQztFQUNuRCxZQUFZLEVBQUUsZ0NBQWdDO0VBQzlDLFdBQVcsRUFBRSw0QkFBNEI7RUFDekMsWUFBWSxFQUFFO0VBQ2Q7QUFDRixDQUFDOztBQUlEO0FBQ08sU0FBU0MsYUFBYUEsQ0FBQ0MsTUFBYyxFQUFVO0VBQ3BELElBQUksQ0FBQyxJQUFBQyxnQkFBUSxFQUFDRCxNQUFNLENBQUMsRUFBRTtJQUNyQixNQUFNLElBQUlFLFNBQVMsQ0FBRSxtQkFBa0JGLE1BQU8sRUFBQyxDQUFDO0VBQ2xEO0VBRUEsTUFBTUcsUUFBUSxHQUFJTCxhQUFhLENBQTRCRSxNQUFNLENBQUM7RUFDbEUsSUFBSUcsUUFBUSxFQUFFO0lBQ1osT0FBT0EsUUFBUTtFQUNqQjtFQUNBLE9BQU8sa0JBQWtCO0FBQzNCIn0=