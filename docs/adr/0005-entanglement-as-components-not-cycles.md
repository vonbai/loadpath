# Report entanglement as strongly connected components, not as a list of cycles

v0.1.0 enumerated two- and three-directory cycles with nested loops — O(V·d²), and structurally blind to any cycle longer than three. Tarjan's algorithm finds every strongly connected component in O(V+E) with an iterative formulation that avoids Python-style recursion limits.

The output shape matters more than the complexity. "These seven directories are mutually entangled" is the fact a reader needs; a list of the triangles inside that set is an arbitrary slice of it.
