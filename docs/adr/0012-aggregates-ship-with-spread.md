# Every aggregate ships with its spread, its worst case, and its parameter

Measured on identical predictions, a model reached an expected calibration error of 2–3% — which looks excellent — while its maximum calibration error hit 99–100%, because overconfident and underconfident regions cancel in the mean. Separately, a logistic regression on added lines alone scored AUC 0.75 with recall 0.078: a raw size count producing a plausible ranking while detecting almost nothing.

So an average alone is not reportable. Each aggregate carries the buckets it summarises rather than a restatement of them, the bucket count as a stated parameter, the denominator the ratio is taken over, and a flag when the mass sits in a single bucket — because that concentration is the signal and the mean over it is not. A min and a max printed beside four visible numbers say nothing the numbers do not; the denominator, which was missing, is what made the ratio readable. On identical data, 50 bins produced systematically higher miscalibration than 15, and equal-width bins higher than adaptive ones, so an undisclosed bucketing choice is a hidden assumption.

Every measurement is also computed as-of the point of use. Training on information unavailable at that point inflated one model's reported F-measure by 38.5% and 45.7%.
