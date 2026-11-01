# Contract fixture format

T3 fixtures are JSON files with a request and the response shape the twin must return.

```json
{
  "request": {
    "method": "POST",
    "path": "/payments",
    "headers": { "authorization": "Bearer sk_test_ibeji_fixture0001" },
    "body": "{}"
  },
  "response": {
    "status": 200,
    "body": {
      "status": "success",
      "data": { "id": "pay_ref-1", "amount": 1000 }
    }
  }
}
```

`assertContractFile(running, file)` sends the request to `127.0.0.1:<running.port>` and compares the status, the keys at every level, and the value types. Values such as ids and dates may differ. Arrays must have the same length and the same item shapes.

`request.headers` and `request.body` are optional. A response with an empty body must use `"body": null`.
