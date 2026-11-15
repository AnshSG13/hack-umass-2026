"""Home's week: the merged shopping list. No database, no network."""
from realize import week


def test_groceries_merge_by_ingredient_and_add_up_same_units():
    out = week.merge_groceries([
        ("a", "Chickpea curry", [{"qty": 1, "unit": "can", "item": "Coconut milk"},
                                 {"qty": 1, "unit": "", "item": "onion"},
                                 {"qty": 2, "unit": "tbsp", "item": "olive oil"}]),
        ("b", "Chicken au poivre", [{"qty": 2, "unit": "", "item": "Onions"},
                                    {"qty": 1, "unit": "tsp", "item": "Olive oil"},
                                    {"qty": None, "unit": "", "item": "Fresh rosemary"}]),
    ])
    by = {g["key"]: g for g in out}
    assert by["onion"]["amount"] == "3" and by["onion"]["for"] == ["Chickpea curry", "Chicken au poivre"]
    assert by["olive oil"]["amount"] == "2 tbsp + 1 tsp"
    assert by["rosemary"]["amount"] == "" and by["rosemary"]["item"] == "Fresh rosemary"
    assert [g["key"] for g in out] == sorted(g["key"] for g in out)


def test_nothing_planned_means_an_empty_list():
    assert week.merge_groceries([]) == []
    assert week.merge_groceries([("a", "Toast", [{"item": "  "}])]) == []
