# Migration fixtures

`talend-official-v6.json` is the published Qlik API Tester service-account example export (version 6), with destination hosts replaced by `example.test`. Source: https://help.qlik.com/talend/en-US/api-user-guide/Cloud/using-service-accounts-api . Used solely as an interoperability fixture; tests never call those services.

Additional synthetic fixtures in tests cover malformed inputs and unsupported fields. They are not represented as exports verified against the original extension.

`flow-v6.json` is a synthetic localhost scenario. `talend-roundtrip-v6.json` is that scenario imported and re-exported through the original Talend API Tester Free Edition 25.20.0 on 2026-11-16 in an isolated test Chromium profile. It verifies native scenario ordering, status/JSON assertions, named response expressions, and null private variable values. It contains only generated test data; no account or personal browser data was used. The original normalizes IDs and omitted the synthetic `uri.port` field. E2E substitutes the local test server authority into this native roundtrip fixture before sending requests. The original extension's source/assets are not included.
