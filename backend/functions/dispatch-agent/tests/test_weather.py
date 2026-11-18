from weather import fly_call


def test_calm_is_go():
    assert fly_call(3.0, 5.0, 0.0) == ("go", "")


def test_big_gust_is_no_go():
    call, reason = fly_call(5.0, 16.0, 0.0)
    assert call == "no_go"
    assert "Gust" in reason


def test_moderate_rain_is_caution():
    call, reason = fly_call(3.0, 5.0, 12.0)
    assert call == "caution"
    assert "Rain" in reason


def test_thunder_code_is_no_go():
    call, reason = fly_call(3.0, 5.0, 0.0, weather_code=95)
    assert call == "no_go"
    assert "hunder" in reason
