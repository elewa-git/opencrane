import { describe, expect, it } from "vitest";

import { _SanitizeHttpTraceUrl } from "../http-trace.js";

describe("_SanitizeHttpTraceUrl", function _Suite()
{
  it("removes query and fragment values from legacy and stable trace attributes", function _RemovesQuery()
  {
    expect(_SanitizeHttpTraceUrl("/events?cursor=opaque-query&token=opaque-token#fragment", "https://runtime.example.test")).toEqual({
      "http.target": "/events",
      "http.url": "https://runtime.example.test/events",
      "url.full": "https://runtime.example.test/events",
      "url.path": "/events",
      "url.query": "",
    });
  });

  it("preserves a query-free absolute URL without credentials", function _PreservesSafeCoordinates()
  {
    expect(_SanitizeHttpTraceUrl("https://user:password@runtime.example.test:8443/events?cursor=opaque")).toMatchObject({
      "http.url": "https://runtime.example.test:8443/events",
      "url.full": "https://runtime.example.test:8443/events",
      "url.query": "",
    });
  });

  it("fails closed when an invalid transport URL cannot be parsed", function _RejectsInvalidUrl()
  {
    expect(_SanitizeHttpTraceUrl("http://[invalid]?cursor=opaque")).toEqual({
      "http.target": "/",
      "http.url": "[redacted]",
      "url.full": "[redacted]",
      "url.path": "/",
      "url.query": "",
    });
  });
});
