import unittest

from employer_slot_recovery import employer_slots


def spans(text):
    return [text[hit.start:hit.end] for hit in employer_slots(text)]


class EmployerSlotRecoveryTests(unittest.TestCase):
    def test_former_employment_stops_before_research_evidence(self):
        text = "i used to work for maple beacon studio before i changed my pickup window"
        self.assertEqual(spans(text), ["maple beacon studio"])

    def test_shift_statement_and_clock_time_are_distinguished(self):
        self.assertEqual(spans("i arrived for the early shift at meadow harbor clinic"), ["meadow harbor clinic"])
        self.assertEqual(spans("i arrived for my morning shift at five thirty"), [])

    def test_pay_source_stays_inside_the_original_clause(self):
        text = "my paycheck comes from blue maple studio and i used the cash to buy lunch"
        self.assertEqual(spans(text), ["blue maple studio"])

    def test_workplace_field_keeps_complete_fragmented_value(self):
        text = "i put paper stone tool works in the employer field"
        self.assertEqual(spans(text), ["paper stone tool works"])

    def test_colleague_attribution_stops_before_the_statement(self):
        text = "my colleague at pear tree cooperatives recommended buying it twice"
        self.assertEqual(spans(text), ["pear tree cooperatives"])

    def test_public_merchant_and_workplace_description_remain_available(self):
        self.assertEqual(spans("our package came by willow grove delivery and i opened it at work"), [])
        self.assertEqual(spans("i work at the front desk"), [])

    def test_legal_suffix_completes_compound_payroll_value(self):
        text = "The firm on my payslip is Bracken Vale Cartage and Cold Storage Ltd., but I stop at Orchard Grain Market."
        self.assertEqual(spans(text), ["Bracken Vale Cartage and Cold Storage Ltd."])

    def test_shift_assignment_recovers_spelled_initials_without_casing(self):
        text = "my shifts are assigned by maple point s and r accessibility services and the calendar was useful"
        self.assertEqual(spans(text), ["maple point s and r accessibility services"])

    def test_explicit_hr_or_supervisor_stops_at_legal_suffix(self):
        self.assertEqual(
            spans("I file leave with the HR office of Violet Harbor Assisted Living Co. Their portal was difficult."),
            ["Violet Harbor Assisted Living Co."],
        )
        self.assertEqual(
            spans("my new supervisor at Réserve Stone Packaging Group Inc. offered me a rotating schedule"),
            ["Réserve Stone Packaging Group Inc."],
        )

    def test_staffing_prose_and_third_party_evidence_are_preserved(self):
        for text in (
            "the packing slip lists Bracken Vale Cartage and Cold Storage Ltd. as the carrier",
            "my shifts are assigned by temporary staffing services and the calendar sent a reminder",
            "my shifts are assigned by a supervisor and Bracken Vale Storage Ltd. offers the best prices",
            "my shifts are assigned by payroll and Bracken Vale Storage Ltd. offers the best prices",
            "I file leave with the HR office of the staffing agency and the public directory helped",
            "the community bulletin listed Maple Point S and R Accessibility Services",
        ):
            with self.subTest(text=text):
                self.assertEqual(spans(text), [])
