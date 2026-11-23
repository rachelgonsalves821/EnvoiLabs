import unittest

from candidate import Hit, candidate_hits, mask


class CandidateTests(unittest.TestCase):
    def assert_span(self, source, span):
        result = mask(source, candidate_hits(source, (), ()))
        offset = source.index(span)
        self.assertEqual(len(result), len(source))
        self.assertEqual(result[offset:offset + len(span)], "\ue000" * len(span))

    def test_mixed_contact_renderings(self):
        for source, span in [
            ("The contact was (202) 555 0112 ext 7.", "(202) 555 0112 ext 7"),
            ("The number was two oh two, five five five, zero one seven two.", "two oh two, five five five, zero one seven two"),
            ("They sent it to blue car113 at example dot com.", "blue car113 at example dot com"),
            ("My email was id (at) paper (dot) test.", "id (at) paper (dot) test"),
            ("Drop it by 151 Hollow Terrace, Apartment 4.", "151 Hollow Terrace, Apartment 4"),
            ("The address was 107 Orchard Loop Road, Unit 4B.", "107 Orchard Loop Road, Unit 4B"),
            ("The address was Post Office Box eighty seven.", "Post Office Box eighty seven"),
        ]:
            with self.subTest(span=span):
                self.assert_span(source, span)

    def test_overlaps_preserve_following_evidence(self):
        self.assertEqual(mask("abcdef later", [Hit("name", 0, 4), Hit("email", 2, 6)]), "\ue000" * 6 + " later")
        with self.assertRaises(ValueError):
            mask("abc", [Hit("name", -1, 1)])

    def test_literal_mailboxes_cover_complete_dot_atoms_and_dns_suffixes(self):
        for local, host in [
            ("river.o'neil+qa", "invoices.example.co.nz"),
            ("kite=ops", "a.b.c.d.e.example.test"),
            ("hazel+exp", "customer.example"),
        ]:
            address = f"{local}@{host}"
            source = f"Set the reply address to {address}. The search filter was easy to find."
            with self.subTest(address=address):
                expected = source.replace(address, "\ue000" * len(address))
                self.assertEqual(mask(source, candidate_hits(source, (), ())), expected)

    def test_spoken_public_website_preserves_evidence_but_explicit_mailbox_stays_private(self):
        public_ref = "I checked the public menu at hazelwheel dot test before comparing options."
        self.assertEqual(mask(public_ref, candidate_hits(public_ref, (), ())), public_ref)
        self.assert_span("My email address is menu at hazelwheel dot test.", "menu at hazelwheel dot test")

    def test_evidence_countercue_does_not_override_a_direct_phone_cue(self):
        source = "The receipt order number was 2025550121."
        contact = "2025550121"
        hit = Hit("PHONE_NUMBER", source.index(contact), source.index(contact) + len(contact))
        self.assertEqual(mask(source, candidate_hits(source, [hit], [])), source)
        self.assert_span("My phone number on the receipt was 2025550121.", contact)

    def test_product_cue_does_not_ignore_a_detected_person(self):
        source = "The menu called it Wilma Winters."
        contact = "Wilma Winters"
        hit = Hit("person", source.index(contact), source.index(contact) + len(contact))
        self.assertNotEqual(mask(source, candidate_hits(source, [], [hit])), source)


if __name__ == "__main__":
    unittest.main()
