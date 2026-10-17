# Supervisor eval comparison

> These metrics describe SupervisorAgent output on synthetic fixtures (card-quality proxies). They are not evidence of student supervision skill, metacognition, or reduced AI overreliance.

|               | base                      | head                      |
| ------------- | ------------------------- | ------------------------- |
| mode          | live                      | live                      |
| generated     | 2026-09-29T04:11:57Z      | 2026-09-29T05:50:57Z      |
| promptVersion | 1.0.0+256c9520            | 1.1.0+152895a8            |
| policyVersion | 1.0.0                     | 1.0.0                     |
| model         | anthropic/claude-sonnet-5 | anthropic/claude-sonnet-5 |
| fixtures      | 30                        | 30                        |

## dev · anthropic/claude-sonnet-5

| metric                       | base   | head   | Δ        |
| ---------------------------- | ------ | ------ | -------- |
| results                      | 19     | 19     | ±0       |
| shown rate                   | 78.9%  | 78.9%  | ±0       |
| provoke agreement            | 100.0% | 100.0% | ±0       |
| false provokes               | 0      | 0      | ±0       |
| missed provokes              | 0      | 0      | ±0       |
| drop-reason match (controls) | —      | —      | —        |
| locale compliance            | 100.0% | 100.0% | ±0       |
| criterion linkage            | 80.0%  | 100.0% | +20.0 pp |
| evidence precision (mean)    | 1.00   | 1.00   | ±0       |
| required evidence cited      | 100.0% | 100.0% | ±0       |
| median question chars        | 57     | 80     | +23      |
| questions over 140 chars     | 0      | 0      | ±0       |
| model calls                  | —      | 15     | —        |
| retries                      | —      | 0      | —        |

| drop reason   | base | head | Δ   |
| ------------- | ---- | ---- | --- |
| provoke_false | 4    | 4    | ±0  |

## holdout · anthropic/claude-sonnet-5

| metric                       | base   | head   | Δ        |
| ---------------------------- | ------ | ------ | -------- |
| results                      | 11     | 11     | ±0       |
| shown rate                   | 45.5%  | 45.5%  | ±0       |
| provoke agreement            | 100.0% | 100.0% | ±0       |
| false provokes               | 0      | 0      | ±0       |
| missed provokes              | 0      | 0      | ±0       |
| drop-reason match (controls) | —      | —      | —        |
| locale compliance            | 100.0% | 100.0% | ±0       |
| criterion linkage            | 80.0%  | 100.0% | +20.0 pp |
| evidence precision (mean)    | 1.00   | 1.00   | ±0       |
| required evidence cited      | 100.0% | 100.0% | ±0       |
| median question chars        | 78     | 74     | −4       |
| questions over 140 chars     | 0      | 0      | ±0       |
| model calls                  | —      | 5      | —        |
| retries                      | —      | 0      | —        |

| drop reason   | base | head | Δ   |
| ------------- | ---- | ---- | --- |
| provoke_false | 6    | 6    | ±0  |

## Changed fixtures

| fixture                        | split   | base                   | head  |
| ------------------------------ | ------- | ---------------------- | ----- |
| diff-refactor-ko-guided        | dev     | shown [criterion link] | shown |
| retry-fetch-401-en-guided      | dev     | shown [criterion link] | shown |
| retry-module-missing-ko-guided | dev     | shown [criterion link] | shown |
| retry-map-undefined-ko-work    | holdout | shown [criterion link] | shown |
