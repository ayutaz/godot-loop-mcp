const payload = {
  summary: {
    total: 3,
    passed: 3,
    failed: 0,
    skipped: 0
  },
  suites: [
    {
      name: "mock-suite",
      passed: true
    }
  ]
};

process.stdout.write(`${JSON.stringify(payload)}\n`);
