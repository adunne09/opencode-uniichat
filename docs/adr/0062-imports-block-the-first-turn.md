# ADR-0062: Imported turns block the first turn

Accepted. Differs from the released UniiChat.

Victor's code lets a turn start while an import is still being summarized, so the model may answer without part of the past. Here the first turn after switch-on waits until every imported message has a line in the view ([0043](0043-import-earlier-turns.md)). Waiting costs time once per session, and in return the model sees the whole session from its first turn. The wait always ends: a hung call times out ([0042](0042-compaction-call-timeout.md)), and a compaction that returns no text uses its source clipped ([0056](0056-no-text-clips-the-source.md)).
