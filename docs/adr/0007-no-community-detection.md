# No community detection, ever

Suggesting module boundaries by clustering the dependency graph is the obvious next feature and it does not work. Measured on a real repository: 20 Louvain seeds produced 20 distinct partitions with modularity spread across 0.233–0.262 — mutually contradictory answers, all near-equally optimal, with 13–23% of directory pairs classified differently between runs. Label propagation collapsed to a single community containing every directory, Q = 0.000, on every seed.

The resolution limit settles it regardless of algorithm: modularity cannot resolve a community with fewer than about √(2m) internal edges, which was 30.7 on that graph, while a three-directory module has about three. Modularity is blind by an order of magnitude to exactly the scale this skill reasons about.

Shipping it would put 20 mutually equivalent answers behind one printed recommendation, in a tool whose contract is that a measurement licenses a question and never a move.
