/** Optional Playgrounds functions entry; KV is provided by the host API. */
export default {
  async fetch(request) {
    return Response.json({
      ok: true,
      name: "pg-pierbox",
      path: new URL(request.url).pathname,
    });
  },
};
