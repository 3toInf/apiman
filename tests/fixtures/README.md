# Migration fixtures

`talend-official-v6.json` is the published Qlik API Tester service-account example export (version 6), with destination hosts replaced by `example.test`. Source: https://help.qlik.com/talend/en-US/api-user-guide/Cloud/using-service-accounts-api . Used solely as an interoperability fixture; tests never call those services.

Additional synthetic fixtures in tests cover malformed inputs and unsupported fields. They are not represented as exports verified against the original extension.
