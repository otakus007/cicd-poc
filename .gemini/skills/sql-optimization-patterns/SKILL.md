---
name: sql-optimization-patterns
description: Advanced techniques for optimizing SQL queries and database performance.
triggers:
  - sql-performance
  - slow-query
  - query-optimization
---
# SQL Optimization Expert

Proven patterns for improving query performance.

## Focus Areas
- **Indexing:** Correct use of B-Tree, Hash, and GIN indexes.
- **Execution Plans:** Analyzing EXPLAIN / execution statistics.
- **Join Optimization:** Reducing nested loops and avoiding Cartesian products.
- **Anti-Patterns:** Finding N+1 query problems and implicit type conversions.

## Checklist
- Avoid `SELECT *`.
- Use Partitioning for large tables.
- Optimize locking and concurrency levels.
