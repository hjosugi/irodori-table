    use super::*;
    use irodori_jobs::{JobCheckpoint, JobKind, JobRuntime, JobSpec};

    fn resumable_spec(title: &str) -> JobSpec {
        JobSpec {
            resumable: true,
            ..JobSpec::new(JobKind::IndexBuild, title)
        }
    }

    fn runtime_with_job(id: &str) -> JobRuntime {
        let runtime = JobRuntime::default();
        runtime
            .submit_with_id(id, resumable_spec("index build"))
            .expect("submit");
        runtime
    }

    fn doc(n: usize, text: &str) -> Document {
        Document::new(format!("doc-{n}"), "test", text)
    }

    #[tokio::test]
    async fn builds_and_queries_a_small_corpus() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("j1");
        let corpus = vec![
            doc(0, "the quick brown fox"),
            doc(1, "the lazy brown dog"),
            doc(2, "quick quick quick foxes"),
        ];
        let report = build_index(&runtime, "j1", &store, corpus, IndexBuildConfig::default())
            .await
            .expect("build");

        assert_eq!(report.documents_indexed, 3);
        assert!(!report.cancelled);
        assert_eq!(store.document_count().await.unwrap(), 3);

        // "brown" is in docs 0 and 1.
        let brown = store.search("brown").await.unwrap();
        assert_eq!(brown.len(), 2);
        assert!(brown.iter().any(|p| p.doc_id == "doc-0"));
        assert!(brown.iter().any(|p| p.doc_id == "doc-1"));

        // "quick" appears 3x in doc 2, 1x in doc 0 → doc 2 ranks first by frequency.
        let quick = store.search("quick").await.unwrap();
        assert_eq!(quick[0].doc_id, "doc-2");
        assert_eq!(quick[0].frequency, 3);

        // Normalization: a mixed-case query hits the same postings.
        assert_eq!(store.search("BROWN").await.unwrap().len(), 2);
        assert!(store.search("missing").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rebuild_is_idempotent() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let corpus = vec![doc(0, "alpha beta"), doc(1, "beta gamma")];

        let runtime = runtime_with_job("a");
        build_index(
            &runtime,
            "a",
            &store,
            corpus.clone(),
            IndexBuildConfig::default(),
        )
        .await
        .unwrap();
        let postings_after_first = store.posting_count().await.unwrap();

        // Re-indexing the same corpus must not duplicate documents or postings.
        let runtime2 = runtime_with_job("b");
        build_index(&runtime2, "b", &store, corpus, IndexBuildConfig::default())
            .await
            .unwrap();
        assert_eq!(store.document_count().await.unwrap(), 2);
        assert_eq!(store.posting_count().await.unwrap(), postings_after_first);
    }

    #[tokio::test]
    async fn memory_stays_flat_over_a_large_corpus() {
        // The anti-OOM guarantee: peak postings RAM is bounded by the flush budget
        // no matter how many documents stream through, and the index is complete
        // and queryable afterward. The corpus is a lazy iterator, so it is never
        // fully materialized either.
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("big");
        let total = 50_000usize;
        let flush_postings = 5_000usize;
        let corpus = (0..total).map(|n| {
            // Each doc has ~4 distinct terms: a shared one, a bucketed one, a rare one.
            Document::new(
                format!("doc-{n}"),
                "synthetic",
                format!("common term bucket{} unique{}", n % 100, n),
            )
        });

        let config = IndexBuildConfig {
            flush_postings,
            progress_every_docs: 5_000,
            checkpoint_every_docs: 10_000,
        };
        let report = build_index(&runtime, "big", &store, corpus, config)
            .await
            .expect("build");

        assert_eq!(report.documents_indexed, total as u64);
        assert!(
            report.peak_buffer_postings <= flush_postings + 8,
            "peak buffer {} must stay near the flush budget {}",
            report.peak_buffer_postings,
            flush_postings
        );
        assert_eq!(store.document_count().await.unwrap(), total as u64);
        // "common" is in every document.
        assert_eq!(store.search("common").await.unwrap().len(), total);
        // A bucket term is shared by 1/100th of the corpus.
        assert_eq!(store.search("bucket7").await.unwrap().len(), total / 100);
        // A unique term hits exactly one document.
        let unique = store.search("unique42").await.unwrap();
        assert_eq!(unique.len(), 1);
        assert_eq!(unique[0].doc_id, "doc-42");

        // The job finished and recorded throughput + an artifact.
        let job = runtime.get("big").unwrap();
        assert_eq!(job.status, irodori_jobs::JobStatus::Succeeded);
        assert!(!job.artifacts.is_empty());
    }

    #[tokio::test]
    async fn resumes_from_checkpoint_after_cancellation() {
        let store = IndexStore::open_in_memory().await.expect("open");
        let runtime = runtime_with_job("r");
        let total = 5_000usize;
        let build_corpus = || (0..total).map(|n| doc(n, &format!("word{} shared", n % 10)));

        // First pass: cancel partway through. The checkpoint records the cursor.
        // The job must be Running before a cancel request (cancelling a still-queued
        // job terminates it outright), so start it, then request cancellation: the
        // build's first progress check then stops it cooperatively.
        let config = IndexBuildConfig {
            flush_postings: 1_000,
            progress_every_docs: 500,
            checkpoint_every_docs: 1_000,
        };
        runtime.start("r").unwrap();
        runtime.request_cancel("r").unwrap();
        let first = build_index(&runtime, "r", &store, build_corpus(), config)
            .await
            .unwrap();
        assert!(first.cancelled);
        assert!(first.documents_indexed < total as u64);
        let partial = store.document_count().await.unwrap();
        assert!(partial > 0 && partial < total as u64);

        // Resume on a fresh job seeded with the prior checkpoint: it skips the
        // already-indexed prefix and finishes the rest.
        let runtime2 = JobRuntime::default();
        runtime2
            .submit_with_id("r2", resumable_spec("resume"))
            .unwrap();
        runtime2.start("r2").unwrap();
        runtime2
            .update_checkpoint("r2", JobCheckpoint::new(1, partial.to_string(), "{}"))
            .unwrap();

        let second = build_index(&runtime2, "r2", &store, build_corpus(), config)
            .await
            .unwrap();
        assert!(!second.cancelled);
        assert_eq!(second.resumed_from, partial);
        assert_eq!(second.documents_skipped, partial);
        assert_eq!(second.documents_indexed, total as u64 - partial);

        // The combined index covers the whole corpus with no gaps or duplicates.
        assert_eq!(store.document_count().await.unwrap(), total as u64);
        assert_eq!(store.search("shared").await.unwrap().len(), total);
    }
