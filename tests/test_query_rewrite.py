from app.services.query_rewrite import rewrite_query


def test_rewrite_normalizes_model_code():
    assert "NC-500" in rewrite_query("NC500 保修多长时间")


def test_rewrite_expands_spoken_term():
    rewritten = rewrite_query("NC500 老趴窝是咋回事")
    assert "NC-500" in rewritten
    assert "设备停机" in rewritten
