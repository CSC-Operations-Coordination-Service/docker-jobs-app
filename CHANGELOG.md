# Changelog

## 0.2.0

- A job's **User** (as `docker run --user` takes it: `100`, `100:101`, a name; empty keeps the
  image's `USER`), and a **uid** column on secrets, which are mounted 0400 for their uid: give a
  secret the job's uid. Saving or enabling a job keeps its user. Needs docker-jobs-backend 0.3.0.

## 0.1.1

- An attempt's Logs link opens Explore under Grafana's sub-path, when Grafana is served under one
  (`root_url` ending in a path): it led to the root before.

## 0.1.0

- Jobs, job editor, runs and attempts, rerun and cancel, overview dashboard.
