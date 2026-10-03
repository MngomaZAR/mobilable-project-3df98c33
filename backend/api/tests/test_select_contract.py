import unittest

from fastapi import HTTPException

from app.database import parse_select, select_column_names


class SelectContractTests(unittest.TestCase):
    def test_alias_selects_source_column_and_renames_output(self):
        self.assertEqual(parse_select('id,name:full_name'), '"id", "full_name" AS "name"')
        self.assertEqual(select_column_names('id,name:full_name'), ['id', 'full_name'])

    def test_embedded_relation_never_silently_broadens_select(self):
        for parse in [parse_select, select_column_names]:
            for value in ['profiles:author_id(full_name,avatar_url)', 'id,profiles(id)', 'id)']:
                with self.subTest(parse=parse.__name__, value=value):
                    with self.assertRaises(HTTPException) as error:
                        parse(value)
                    self.assertEqual(error.exception.status_code, 400)

    def test_alias_and_column_reject_sql_fragments(self):
        for value in ['name:full_name;drop', 'x";drop:id', 'name:*', 'a:b:c']:
            with self.assertRaises(HTTPException):
                parse_select(value)


if __name__ == '__main__':
    unittest.main()
