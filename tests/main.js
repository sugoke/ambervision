import assert from "assert";

describe("ambervision", function () {
  it("package.json has correct name", async function () {
    const { name } = await import("../package.json");
    assert.strictEqual(name, "ambervision");
  });

  if (Meteor.isClient) {
    it("client is not server", function () {
      assert.strictEqual(Meteor.isServer, false);
    });
  }

  if (Meteor.isServer) {
    it("server is not client", function () {
      assert.strictEqual(Meteor.isClient, false);
    });
  }
});

import "./productSchedule.test.js";
import "./termSheetTextChecks.test.js";

if (Meteor.isServer) {
  // Never run the isolation suite against a shared cluster: it seeds and removes rows.
  if ((process.env.MONGO_URL || '').includes('mongodb+srv')) {
    throw new Error('Refusing to run tests against an Atlas MONGO_URL');
  }
  require("./access/index.js");
}
